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
/** 数字（可带小数点）。 */
const NUM = '\\d+(?:\\.\\d+)?';
/** 单字母 / 双字母（几何里的 EF、BE）/ 单数字，可带指数或下标：x、x²、a₁、m^2。 */
const ATOM = `(?:${NUM}|[a-zA-Z]{1,2})(?:[²³⁴⁰¹⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉]|\\^\\{?[0-9a-zA-Z]\\}?)?`;
/** 括号组：允许里面再有一层浅括号，长度受控。 */
const GROUP = '\\((?:[^()\\n]{1,24})\\)';
/** 分子或分母的候选。 */
const SIDE = `(?:${GROUP}|${ATOM})`;
/** 单位缩写：写成 x/h、x/s、x/km 的都不是分式。 */
const UNIT_WORDS = new Set(['km', 'cm', 'mm', 'kg', 'mL', 'mol', 'ms', 'min', 'sec']);
const FRAC_RE = new RegExp(`(?<![\\w.\\/\\\\])(?<num>${SIDE})\\/(?<den>${SIDE})(?![\\w.\\/\\\\])`, 'g');
/** 分母后面紧跟这些词时，说明是「单位/速度」而不是分式。 */
const UNIT_TAIL_RE = /^\s*(?:km|m|cm|mm|kg|g|h|s|千米|公里|米|厘米|毫米|小时|分钟|秒|天|件|元|人|个|吨|升|毫升|摩尔|mol|L|mL)/i;
/** 分子前面是这些词时，也按单位处理（例如 单价 3 元/件）。 */
const UNIT_HEAD_RE = /(?:度|速|率|价|量|重|长|高|宽|面|体)$/;
function isYearLike(text) {
    return /^\d{4}$/.test(text) && Number(text) >= 1900 && Number(text) <= 2100;
}
/** 判断这次命中是真分式还是单位/日期。 */
function acceptFrac(num, den, before, after) {
    // 日期或年份编号
    if (isYearLike(num) && isYearLike(den))
        return false;
    // 单位缩写：km/h、m/s、mL/g 这类（任一侧是单位就不排）
    if (UNIT_WORDS.has(num) || UNIT_WORDS.has(den))
        return false;
    // 单个字母 m、s、h、g、L 出现在任一侧时按单位处理（速度、密度里极常见）
    if (/^[mshgL]$/.test(den) || /^[mshgL]$/.test(num))
        return false;
    // 单位：分母是字母（km/h 的 h）且后面跟单位词 → 这是速度/密度写法，不是分式；
    // 分母是数字时（16/9 小时、48/7 天）要照常排成分式，否则答案里的分数全变成斜杠。
    if (/^[a-zA-Z]+$/.test(den) && UNIT_TAIL_RE.test(after))
        return false;
    // 单位：分子前面是「速度/单价」这类中心词，且分母是字母
    if (/^[a-zA-Z]+$/.test(den) && UNIT_HEAD_RE.test(before.trimEnd()))
        return false;
    // 分母是纯数字且特别长（编号、电话号码一类）
    if (/^\d{5,}$/.test(den))
        return false;
    return true;
}
/** 把字符串切成 text / frac 混合片段。 */
export function splitMath(input) {
    const tokens = [];
    let cursor = 0;
    FRAC_RE.lastIndex = 0;
    for (let m = FRAC_RE.exec(input); m !== null; m = FRAC_RE.exec(input)) {
        const { num, den } = m.groups ?? {};
        if (!num || !den)
            continue;
        const before = input.slice(Math.max(0, m.index - 4), m.index);
        const after = input.slice(m.index + m[0].length, m.index + m[0].length + 4);
        if (!acceptFrac(num, den, before, after))
            continue;
        // 括号组作为分子/分母时，画的时候去掉外层括号（分式线本身就是分组）
        const numText = num.startsWith('(') && num.endsWith(')') ? num.slice(1, -1) : num;
        const denText = den.startsWith('(') && den.endsWith(')') ? den.slice(1, -1) : den;
        if (m.index > cursor)
            tokens.push({ kind: 'text', text: input.slice(cursor, m.index) });
        tokens.push({ kind: 'frac', num: numText, den: denText });
        cursor = m.index + m[0].length;
    }
    if (cursor < input.length)
        tokens.push({ kind: 'text', text: input.slice(cursor) });
    if (tokens.length === 0)
        tokens.push({ kind: 'text', text: input });
    return tokens;
}
/** 把 `^2`、`^{2}`、`^23`、`^{10}` 这类上标写法转成真上标字符；转不完整的保持原样。 */
export function normalizeExponents(input) {
    return input.replace(/\^\{?([-0-9n]+)\}?/g, (all, group) => {
        if (!canSuperscript(group))
            return all;
        return [...group].map((ch) => toSup(ch)).join('');
    });
}
function toSup(ch) {
    const map = {
        '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
        '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
        'n': 'ⁿ',
    };
    return map[ch] ?? ch;
}
/** 上标是否全部转换成功（有字符没有上标形式时返回 false）。 */
export function canSuperscript(group) {
    return [...group].every((ch) => ch in { '0': 1, '1': 1, '2': 1, '3': 1, '4': 1, '5': 1, '6': 1, '7': 1, '8': 1, '9': 1, 'n': 1 });
}
/** 纯文本版（用于卡片/列表，不需要分式排版时）。 */
export function mathPlain(input) {
    return normalizeExponents(input);
}
