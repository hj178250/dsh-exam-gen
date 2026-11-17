/**
 * 把题干里的线性数学写法拆成「可排版的片段」。
 *
 * 题库和模型给的题干都是纯文本（`y = ax² - 4ax + 3a`、`q/p`、`(2x-1)/3`、`√3`），
 * 直接印出来就是斜杠分数，不像卷子。这里做的事只有一件：
 * 把**能确定的**分数认出来，交给 PDF 层画成上下结构；其余原样保留。
 *
 * 认分数的规则分三档（由窄到宽，能认出更多真分式）：
 *   1. 单元素对单元素：`3/4`、`1/x`、`a/b`、`x²/2`
 *   2. 括号组在分子或分母：`(2x-1)/3`、`1/(x+2)`、`(x+1)/(x-1)`
 *   3. 带上下标的数字：`10²³` 这类不参与，避免把指数当分母
 *
 * 明确不认的（会误伤或改题意）：
 *   · 单位与速度：`45千米/小时`、`km/h`、`米/秒`、`元/件` —— 分母后面紧跟中文单位或时间词
 *   · 日期与编号：`2023/12/31`、`2023/2024` —— 两侧都是四位年份
 *   · 三连斜杠：链式写法 `a/b/c`（连乘链，排出来反而看不懂）
 * 宁可少美化，也不能把题意改错。
 */

export type MathToken =
  | { kind: 'text'; text: string }
  | { kind: 'frac'; num: string; den: string }
  | { kind: 'sqrt'; text: string }

/** 数字（可带小数点）。 */
const NUM = '\\d+(?:\\.\\d+)?'
/** 单字母 / 双字母（几何里的 EF、BE）/ 单数字，可带指数或下标：x、x²、a₁、m^2。 */
const ATOM = `(?:${NUM}|[a-zA-Z]{1,2})(?:[²³⁴⁰¹⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉]|\\^\\{?[0-9a-zA-Z]\\}?)?`
/** 括号组：允许里面再有一层浅括号，长度受控。 */
const GROUP = '\\((?:[^()\\n]{1,24})\\)'
/** 分子或分母的候选。 */
const SIDE = `(?:${GROUP}|${ATOM})`

/** 单位缩写：写成 x/h、x/s、x/km 的都不是分式。 */
const UNIT_WORDS = new Set(['km', 'cm', 'mm', 'kg', 'mL', 'mol', 'ms', 'min', 'sec'])

const FRAC_RE = new RegExp(
  `(?<![\\w.\\/\\\\])(?<num>${SIDE})\\/(?<den>${SIDE})(?![\\w.\\/\\\\])`,
  'g',
)

/** 分母后面紧跟这些词时，说明是「单位/速度」而不是分式。 */
const UNIT_TAIL_RE = /^\s*(?:km|m|cm|mm|kg|g|h|s|千米|公里|米|厘米|毫米|小时|分钟|秒|天|件|元|人|个|吨|升|毫升|摩尔|mol|L|mL)/i
/** 分子前面是这些词时，也按单位处理（例如 单价 3 元/件）。 */
const UNIT_HEAD_RE = /(?:度|速|率|价|量|重|长|高|宽|面|体)$/

function isYearLike(text: string): boolean {
  return /^\d{4}$/.test(text) && Number(text) >= 1900 && Number(text) <= 2100
}

/** 判断这次命中是真分式还是单位/日期。 */
function acceptFrac(num: string, den: string, before: string, after: string): boolean {
  // 日期或年份编号
  if (isYearLike(num) && isYearLike(den)) return false
  // 单位缩写：km/h、m/s、mL/g 这类（任一侧是单位就不排）
  if (UNIT_WORDS.has(num) || UNIT_WORDS.has(den)) return false
  // 单个字母 m、s、h、g、L 出现在任一侧时按单位处理（速度、密度里极常见）
  if (/^[mshgL]$/.test(den) || /^[mshgL]$/.test(num)) return false
  // 单位：分母是字母（km/h 的 h）且后面跟单位词 → 这是速度/密度写法，不是分式；
  // 分母是数字时（16/9 小时、48/7 天）要照常排成分式，否则答案里的分数全变成斜杠。
  if (/^[a-zA-Z]+$/.test(den) && UNIT_TAIL_RE.test(after)) return false
  // 单位：分子前面是「速度/单价」这类中心词，且分母是字母
  if (/^[a-zA-Z]+$/.test(den) && UNIT_HEAD_RE.test(before.trimEnd())) return false
  // 分母是纯数字且特别长（编号、电话号码一类）
  if (/^\d{5,}$/.test(den)) return false
  return true
}

/** 把字符串切成 text / frac / sqrt 混合片段。 */
export function splitMath(input: string): MathToken[] {
  const tokens: MathToken[] = []
  // 先认根号：√3、√(2x-1)、√x²、√21 —— 被开方数是 ATOM 或括号组。
  // 放在分数识别之前：√(2x+1)/3 这种「根号分数」要整体当 sqrt 处理，避免 /3 被先吃成分母。
  const SQRT_RE = new RegExp(
    `√\\s*(?:${GROUP}|${ATOM})`,
    'g',
  )
  const FRAC_RE2 = new RegExp(
    `(?<![\\w.\\/\\\\√])(?<num>${SIDE})\\/(?<den>${SIDE})(?![\\w.\\/\\\\])`,
    'g',
  )
  const hits: Array<{ start: number; end: number; token: MathToken }> = []
  for (const m of input.matchAll(SQRT_RE)) {
    const raw = m[0]
    const inner = raw.replace(/^√\s*/, '')
    hits.push({ start: m.index, end: m.index + raw.length, token: { kind: 'sqrt', text: inner } })
  }
  for (const m of input.matchAll(FRAC_RE2)) {
    const { num, den } = m.groups ?? {}
    if (!num || !den) continue
    const before = input.slice(Math.max(0, m.index - 4), m.index)
    const after = input.slice(m.index + m[0].length, m.index + m[0].length + 4)
    if (!acceptFrac(num, den, before, after)) continue
    const numText = num.startsWith('(') && num.endsWith(')') ? num.slice(1, -1) : num
    const denText = den.startsWith('(') && den.endsWith(')') ? den.slice(1, -1) : den
    hits.push({ start: m.index, end: m.index + m[0].length, token: { kind: 'frac', num: numText, den: denText } })
  }
  // 根号优先；重叠命中（根号内部又套分数）丢弃分数那个
  hits.sort((a, b) => a.start - b.start || (a.token.kind === 'sqrt' ? -1 : 1))
  const kept: typeof hits = []
  let lastEnd = -1
  for (const hit of hits) {
    if (hit.start < lastEnd) continue
    kept.push(hit)
    lastEnd = hit.end
  }
  let cursor = 0
  for (const hit of kept) {
    if (hit.start > cursor) tokens.push({ kind: 'text', text: input.slice(cursor, hit.start) })
    tokens.push(hit.token)
    cursor = hit.end
  }
  if (cursor < input.length) tokens.push({ kind: 'text', text: input.slice(cursor) })
  if (tokens.length === 0) tokens.push({ kind: 'text', text: input })
  return tokens
}

/** 把 `^2`、`^{2}`、`^{10}`、`^{-2}`、`^n` 这类上标写法转成真上标字符；转不完整的保持原样。 */
export function normalizeExponents(input: string): string {
  // 花括号指数 ^{2}、^{-2}、^{10}、^{n}：花括号内允许负号（负指数）。
  let out = input.replace(/\^\{(-?[0-9n]+)\}/g, (all, group: string) => {
    const negative = group.startsWith('-')
    const body = negative ? group.slice(1) : group
    if (!canSuperscript(body)) return all
    return (negative ? '⁻' : '') + [...body].map((ch) => toSup(ch)).join('')
  })
  // 裸指数 ^2、^23、^n：贪婪匹配数字/n，遇到「-」自然停。
  //
  // 这里踩过一个 bug：旧正则用 `[-0-9n]+`，字符类里的 `-` 会把「减法」和「化学电荷」都吸进来——
  // `|a|^2-4a` 里的 `^2-4` 被整体当成指数，canSuperscript('2-4') 失败，于是 `^2` 永远转不成 `²`。
  // 去掉字符类里的 `-` 之后：`^2-4a` → 匹配 `2` → `²-4a`；`CO3^2-` → 匹配 `2` → `CO3²-`；
  // `^23` → 匹配 `23` → `²³`。三种情况都对了。
  out = out.replace(/\^([0-9n]+)/g, (all, group: string) => {
    if (!canSuperscript(group)) return all
    return [...group].map((ch) => toSup(ch)).join('')
  })
  return out
}

function toSup(ch: string): string {
  const map: Record<string, string> = {
    '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
    '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
    'n': 'ⁿ', '-': '⁻',
  }
  return map[ch] ?? ch
}

/** 上标是否全部转换成功（有字符没有上标形式时返回 false）。 */
export function canSuperscript(group: string): boolean {
  return [...group].every((ch) => ch in { '0': 1, '1': 1, '2': 1, '3': 1, '4': 1, '5': 1, '6': 1, '7': 1, '8': 1, '9': 1, 'n': 1, '-': 1 })
}

/** 纯文本版（用于卡片/列表，不需要分式排版时）。 */
export function mathPlain(input: string): string {
  return normalizeExponents(input)
}

/**
 * 化学式规范化：把模型输出的线性化学式转成 Unicode 上下标。
 * 只给化学卷用（数学卷走 normalizeExponents），避免把数学的 `x_1`、`2-3` 误改。
 *
 * 三条规则，由具体到宽泛：
 *   1. 带 ^ 的电荷：`CO3^2-` → `CO₃²⁻`、`^3+` → `³⁺`、`^n-` → `ⁿ⁻`；
 *   2. 裸离子电荷：`Na+` → `Na⁺`、`Ca2+` → `Ca²⁺`、`OH-` → `OH⁻`；
 *   3. 原子数下标：`H2O` → `H₂O`、`C4H8O2` → `C₄H₈O₂`、`MnO2` → `MnO₂`。
 *
 * 下标只认「大写元素符号 + 数字」且数字后不跟 +/-(电荷)、也不跟另一个数字(下标只处理单数字，
 * 多位数下标如 C₁₂H₂₂O₁₁ 由每个元素符号单独命中)。系数如 `2H2O` 的 2、`0.02 mol`、
 * `22.4 L`、`100 mL` 都不会被误伤——它们前面不是元素符号。
 */
const SUB_DIGITS: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
}

function toSub(ch: string): string {
  return SUB_DIGITS[ch] ?? ch
}

function supDigits(group: string): string {
  return [...group].map((ch) => toSup(ch)).join('')
}

export function normalizeChem(input: string): string {
  let out = input
  // 1. 带 ^ 的电荷：^2- → ²⁻、^3+ → ³⁺、^- → ⁻、^+ → ⁺。
  out = out.replace(/\^(\d*)([+-])/g, (_all, num: string, sign: string) => {
    return supDigits(num) + (sign === '+' ? '⁺' : '⁻')
  })
  // 2a. 独立原子带数字电荷（前面不是字母/数字）：Ca2+ → Ca²⁺、Fe3+ → Fe³⁺、Al3+ → Al³⁺、Ag+ → Ag⁺。
  //     数字是电荷数，要上标；符号后面不能再是字母/数字。
  out = out.replace(/(?<![A-Za-z0-9])([A-Z][a-z]?)(\d)([+-])(?![A-Za-z0-9])/g, (_all, atom: string, num: string, sign: string) => {
    return atom + supDigits(num) + (sign === '+' ? '⁺' : '⁻')
  })
  // 2b. 多原子基团里的元素带数字电荷（前面是字母/数字）：HCO3- 的 O3- → O₃⁻、NO3- 的 O3- → O₃⁻、MnO4- 的 O4- → O₄⁻。
  //     数字是原子数下标，符号是电荷上标。前置 lookbehind 区分「独立原子」（Ca2+）与「基团内原子」（HCO3- 里的 O3）。
  out = out.replace(/(?<=[A-Za-z0-9])([A-Z][a-z]?)(\d)([+-])(?![A-Za-z0-9])/g, (_all, atom: string, num: string, sign: string) => {
    return atom + toSub(num) + (sign === '+' ? '⁺' : '⁻')
  })
  // 3. 字母后的裸电荷：OH- → OH⁻、Cl- → Cl⁻、Na+ → Na⁺、H+ → H⁺、ClO- → ClO⁻。
  //    符号后面不能再是字母/数字（否则会把「-H2O」这种连字符误当电荷）。
  out = out.replace(/([A-Z][a-z]?)([+-])(?![A-Za-z0-9])/g, (_all, atom: string, sign: string) => {
    return atom + (sign === '+' ? '⁺' : '⁻')
  })
  // 4. 原子数下标：H2O → H₂O、CO3 → CO₃、C4H8O2 → C₄H₈O₂、MnO2 → MnO₂。
  //    数字后面不能是电荷符号或另一个数字（电荷已在 1~3 处理，多位数下标靠每个元素符号单独命中）。
  out = out.replace(/([A-Z][a-z]?)(\d)(?![+\-0-9])/g, (_all, atom: string, digit: string) => {
    return atom + toSub(digit)
  })
  return out
}

/**
 * 把一段文本切成「普通 / 上标 / 下标」片段，供 PDF 层用「小字号 + Y 偏移」真排版。
 *
 * 为什么要这么做：Windows 宋体（simsun.ttc）只有 ¹²³ 三个上标字形，其余 Unicode
 * 上下标（⁰⁴⁵⁶⁷⁸⁹ⁿ⁻⁺、₀₁₂₃…ₙ）统统缺字形——把这些字符直接交给字体，画出来是空白，
 * 这就是「平方没写上去 / 有些字空了」的根因。解法：不依赖字体自带的上下标字形，
 * 而是把上下标标记解析出来，用普通数字/字母 + 小字号 + 上下偏移真实地画出来。
 *
 * 统一收口的写法：
 *   · Unicode 上下标字符：x²、xⁿ、a₁、S₇、CO₃²⁻、H⁺
 *   · 花括号标记：x^{2}、a_{n+1}、2^{-3}
 *   · 裸标记：x^2、a_n、S_7
 */
export type MathRun =
  | { kind: 'base'; text: string }
  | { kind: 'sup'; text: string }
  | { kind: 'sub'; text: string }

const UNI_SUP: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '⁺': '+', '⁻': '-', '⁼': '=', '⁽': '(', '⁾': ')',
  'ⁿ': 'n', 'ⁱ': 'i', 'ᵃ': 'a', 'ᵇ': 'b', 'ᶜ': 'c', 'ᵈ': 'd', 'ᵉ': 'e', 'ᶠ': 'f', 'ᵍ': 'g', 'ʰ': 'h',
  'ʲ': 'j', 'ᵏ': 'k', 'ˡ': 'l', 'ᵐ': 'm', 'ᵒ': 'o', 'ᵖ': 'p', 'ʳ': 'r', 'ˢ': 's', 'ᵗ': 't', 'ᵘ': 'u',
  'ᵛ': 'v', 'ʷ': 'w', 'ˣ': 'x', 'ʸ': 'y', 'ᶻ': 'z',
}
const UNI_SUB: Record<string, string> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  '₊': '+', '₋': '-', '₌': '=', '₍': '(', '₎': ')',
  'ₐ': 'a', 'ₑ': 'e', 'ₕ': 'h', 'ᵢ': 'i', 'ⱼ': 'j', 'ₖ': 'k', 'ₗ': 'l', 'ₘ': 'm', 'ₙ': 'n', 'ₒ': 'o',
  'ₚ': 'p', 'ᵣ': 'r', 'ₛ': 's', 'ₜ': 't', 'ᵤ': 'u', 'ᵥ': 'v', 'ₓ': 'x',
}

export function parseMathRuns(input: string): MathRun[] {
  const runs: MathRun[] = []
  let base = ''
  const flush = (): void => {
    if (base) { runs.push({ kind: 'base', text: base }); base = '' }
  }
  let i = 0
  while (i < input.length) {
    const ch = input[i]
    // 1) Unicode 上标字符（连续成段）
    if (ch in UNI_SUP) {
      flush()
      let s = ''
      while (i < input.length && input[i] in UNI_SUP) { s += UNI_SUP[input[i]]; i++ }
      runs.push({ kind: 'sup', text: s })
      continue
    }
    // 2) Unicode 下标字符（连续成段）
    if (ch in UNI_SUB) {
      flush()
      let s = ''
      while (i < input.length && input[i] in UNI_SUB) { s += UNI_SUB[input[i]]; i++ }
      runs.push({ kind: 'sub', text: s })
      continue
    }
    // 3) 花括号 / 圆括号标记 ^{...} / _{...} / ^(...) / _(...)
    //    模型常写成 a_(n+1)、^(6-2k)、2^(n+1)，圆括号里还能带 +/-/数字，都要认。
    if (ch === '^' || ch === '_') {
      const open = input[i + 1]
      if (open === '{' || open === '(') {
        const closeCh = open === '{' ? '}' : ')'
        const close = input.indexOf(closeCh, i + 2)
        if (close > i + 2 && close - i <= 14) {
          flush()
          runs.push({ kind: ch === '^' ? 'sup' : 'sub', text: input.slice(i + 2, close) })
          i = close + 1
          continue
        }
      }
    }
    // 4) 裸标记 ^abc / _abc
    if (ch === '^' || ch === '_') {
      const m = new RegExp(`^\\${ch}([0-9a-zA-Z]+)`).exec(input.slice(i))
      if (m) {
        flush()
        runs.push({ kind: ch === '^' ? 'sup' : 'sub', text: m[1] })
        i += m[0].length
        continue
      }
    }
    base += ch
    i++
  }
  flush()
  return runs
}
