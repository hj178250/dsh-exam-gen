/**
 * 拖拽/粘贴文档 → 1:1 模仿出卷（纯函数，零 LLM 调用）。
 *
 * 甲方需求 m12189③：把拖进对话区的试卷/题目文档识别成结构化 blueprint，
 * 再按 blueprint 1:1 还原题型 / 题量 / 小问结构，只改「数字 + 情境」，
 * 产出一份符合 PaperResult 的卷子，交给现有 PDF 渲染流水线。
 *
 * 这里刻意不做任何模型调用，也不依赖 ctx：parseBlueprint / buildMimicPaper
 * 都是确定性纯函数，同样的输入永远得到同样的输出，方便自检与复用。
 */
import { resolveChoiceAnswer, validatePaper } from './modes/paper.js'
import type { PaperQuestion, PaperResult, QuestionType } from './modes/paper.js'

export interface BlueprintQuestion {
  type: QuestionType
  /** 题干原文（数字保留，题号已剥掉）。 */
  content: string
  options: string[]
  answer: string
  analysis?: string
  topic?: string
  points: number
  /** 识别出的数字（题干 + 选项 + 答案），供诊断。 */
  numbers: number[]
}

export interface Blueprint {
  title: string
  questions: BlueprintQuestion[]
  /** 有没有真识别出题目；没识别出时 questions 也会兜底成 1 道，不抛异常。 */
  recognized: boolean
  /** 诊断信息：识别出的题号 / 题型分布。 */
  summary: string
}

export interface MimicOptions {
  grade?: string
  subject?: string
  count?: number
  difficulty?: '基础' | '中等' | '拔高'
}

const TYPE_DEFAULT_POINTS: Record<QuestionType, number> = {
  choice: 5,
  multi: 6,
  fill: 5,
  solve: 12,
}

/** 题型名，供诊断摘要。 */
const TYPE_LABEL: Record<QuestionType, string> = {
  choice: '选择',
  multi: '多选',
  fill: '填空',
  solve: '解答',
}

// —— 行首题号 / 选项 / 答案 识别 ——
const Q_RE = /^\s*(?:第\s*\d{1,3}\s*题\s*[:：]?\s*|\d{1,3}\s*[.、．)）]\s*)/
const OPT_RE = /^\s*([A-Ha-h])\s*[.、．)）]\s*(.*)$/
const ANS_RE = /^\s*(?:参考答案|答案|答)\s*[:：]\s*(.*)$/
const POINTS_RE = /[（(]\s*(\d{1,3})\s*分\s*[)）]/

/** 空白空位：填空题判据。 */
const BLANK_RE = /[_＿]{2,}|____|（\s*）|\(\s*\)/

/** 情境名词替换（确定性、只动情境不动考点；不用随机数保证可复现）。 */
const SCENE_SWAP: Array<[RegExp, string]> = [
  [/小明/g, '小华'],
  [/小红/g, '小丽'],
  [/某班/g, '某校'],
  [/某商店/g, '某超市'],
  [/某商场/g, '某市场'],
  [/某工厂/g, '某车间'],
]

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = toNumber(value)
  if (parsed === undefined) return fallback
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

/** 提取一段文本里所有数字（整数 + 小数，含负号）。 */
export function extractNumbers(text: string): number[] {
  const out: number[] = []
  const re = /-?\d+(?:\.\d+)?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const value = Number(m[0])
    if (Number.isFinite(value)) out.push(value)
  }
  return out
}

/** 数字位数（小数部分长度）。 */
function decimalPlaces(value: number): number {
  const s = String(Math.abs(value))
  const dot = s.indexOf('.')
  return dot < 0 ? 0 : s.length - dot - 1
}

function roundTo(value: number, decimals: number): number {
  if (decimals <= 0) return Math.trunc(value)
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * 确定性改数字：保持符号与小数位数，值向上浮动 1~5。
 * 不引入随机数，同一题同一位置永远得到同一个新数字。
 */
function mutateNumber(value: number, salt: number): number {
  const negative = value < 0
  const abs = Math.abs(value)
  const decimals = decimalPlaces(abs)
  const step = 1 + (salt % 5)
  let next = abs + step
  // 小数题改一个「看起来自然」的增量：0.5 / 1.5 / 2.5 / 3.5，避免 3.14 → 6.14 这种跳变。
  if (decimals > 0) {
    const fracStep = [0.5, 1.5, 2.5, 3.5][salt % 4]
    next = abs + fracStep
  }
  next = roundTo(next, decimals)
  return negative ? -next : next
}

/**
 * 替换文本里的数字（保留小问编号 `(1)` `（2）` 与圈码 ①…⑩ 不动，保持小问结构）。
 * 返回替换后的文本与「替换了几处」。
 *
 * 负号处理：`12-5` 里的 `-` 是减号，不能当成负号前缀把 5 换成负数；
 * 只有 `-5℃`、`(-5)` 这种「前面不是数字/右括号/等号」的 `-` 才算负号。
 */
function replaceNumbers(text: string, saltBase: number): { text: string; changed: number } {
  let matchIndex = 0
  let changed = 0
  const out = text.replace(/\d+(?:\.\d+)?/g, (raw, offset, full) => {
    const before = full[offset - 1] ?? ''
    const after = full[offset + raw.length] ?? ''
    // 小问编号 (1) （2）：前后是括号且是 1~2 位纯数字 → 保持原样。
    if (/[（(]/.test(before) && /[）)]/.test(after) && /^\d{1,2}$/.test(raw)) return raw
    // 负数：紧邻的 `-` 若前面不是数字/小数点/右括号/等号，才是负号，把它一并纳入。
    let prefix = ''
    if (before === '-') {
      const prev2 = full[offset - 2] ?? ''
      if (!/[\d.=)）]/.test(prev2)) prefix = '-'
    }
    const salt = saltBase * 997 + matchIndex * 31
    matchIndex += 1
    const value = Number(prefix + raw)
    const next = mutateNumber(value, salt)
    if (next !== value) changed += 1
    return String(next)
  })
  return { text: out, changed }
}

/** 情境替换 + 数字替换一起做（情境只动 whitelist 里的专名，不碰几何/单位）。 */
function rewriteQuestionText(text: string, saltBase: number): string {
  let out = text
  for (const [re, to] of SCENE_SWAP) out = out.replace(re, to)
  return replaceNumbers(out, saltBase).text
}

/** 判断题号起始行，并返回「题号」与「题号后的剩余文本」。 */
function matchQuestionStart(line: string): { number: number; rest: string } | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  // 第 1 题 / 第1题：题干
  const dai = trimmed.match(/^第\s*(\d{1,3})\s*题\s*[:：]?\s*/)
  if (dai) return { number: Number(dai[1]), rest: trimmed.slice(dai[0].length) }
  // 1. / 1、 / 1． / 1) / 1） 题干
  const num = trimmed.match(/^(\d{1,3})\s*[.、．)）]\s*/)
  if (num) return { number: Number(num[1]), rest: trimmed.slice(num[0].length) }
  return null
}

/** 从纯文本识别出 blueprint。识别不出来也兜底成 1 道，绝不抛异常。 */
export function parseBlueprint(sourceText: string): Blueprint {
  const text = (sourceText ?? '').replace(/\r\n?/g, '\n')
  const lines = text.split('\n')

  const questions: BlueprintQuestion[] = []
  let title = ''
  let current: {
    content: string[]
    options: string[]
    answer: string
    analysis: string
    points: number
    started: boolean
  } | null = null

  const flush = (): void => {
    if (!current || !current.started) {
      current = null
      return
    }
    const content = current.content.join('\n').trim()
    if (!content && current.options.length === 0 && !current.answer) {
      current = null
      return
    }
    const answer = current.answer.trim()
    const hasOptions = current.options.length >= 2
    const normalizedOptions = current.options.map((o) => o.trim()).filter(Boolean)

    let type: QuestionType
    if (hasOptions) {
      // 答案里出现两个以上字母 → 多选，否则单选。
      const letters = answer.toUpperCase().replace(/[^A-H]/g, '')
      type = new Set(letters.split('')).size >= 2 ? 'multi' : 'choice'
    } else if (BLANK_RE.test(content)) {
      type = 'fill'
    } else {
      type = 'solve'
    }

    const numbers = extractNumbers([content, ...normalizedOptions, answer, current.analysis].join('\n'))
    questions.push({
      type,
      content,
      options: normalizedOptions,
      answer,
      analysis: current.analysis.trim() || undefined,
      points: current.points > 0 ? current.points : TYPE_DEFAULT_POINTS[type],
      numbers,
    })
    current = null
  }

  for (const rawLine of lines) {
    const line = rawLine
    const start = matchQuestionStart(line)
    if (start) {
      flush()
      current = { content: [], options: [], answer: '', analysis: '', points: 0, started: true }
      if (start.rest) current.content.push(start.rest)
      continue
    }

    if (!current) {
      // 还没进入任何题：收集卷名（取第一行短文本，且不是选项/答案行）。
      const t = line.trim()
      if (!title && t && !OPT_RE.test(line) && !ANS_RE.test(line) && t.length <= 40) {
        title = t
      }
      continue
    }

    // 选项行
    const opt = OPT_RE.exec(line)
    if (opt) {
      current.options.push(opt[2] ?? '')
      continue
    }
    // 答案行
    const ans = ANS_RE.exec(line)
    if (ans) {
      current.answer = ans[1] ?? ''
      continue
    }
    // 解析行
    const ana = line.match(/^\s*(?:解析|分析|详解)\s*[:：]\s*(.*)$/)
    if (ana) {
      current.analysis = (current.analysis ? current.analysis + '\n' : '') + (ana[1] ?? '')
      continue
    }
    // 分值（从答案/题干里顺手抓）
    const pts = POINTS_RE.exec(line)
    if (pts) current.points = Number(pts[1]) || 0

    current.content.push(line)
  }
  flush()

  // 兜底：整段文本没有任何题号时，按空白行 / 句号拆成至少 1 道题。
  if (questions.length === 0) {
    const trimmed = text.trim()
    if (trimmed) {
      questions.push({
        type: 'solve',
        content: trimmed,
        options: [],
        answer: '',
        points: TYPE_DEFAULT_POINTS.solve,
        numbers: extractNumbers(trimmed),
      })
    }
  }

  const recognized = questions.length > 0
  const dist = questions.reduce<Record<string, number>>((acc, q) => {
    acc[TYPE_LABEL[q.type]] = (acc[TYPE_LABEL[q.type]] ?? 0) + 1
    return acc
  }, {})
  const summary = `${questions.length} 题 · ${Object.entries(dist).map(([k, v]) => `${k}${v}`).join('/') || '无'}`
  return { title: title || '1:1 模仿卷', questions, recognized, summary }
}

/** 按 blueprint 1:1 还原：题型/题量/小问结构不变，只改数字与情境。 */
export function buildMimicPaper(blueprint: Blueprint, opts: MimicOptions = {}): PaperResult {
  const grade = opts.grade ?? '初一'
  const subject = opts.subject ?? '数学'

  const source = blueprint.questions
  const count = clampInt(opts.count, 1, 60, source.length || 1)
  // 题量对齐：少了截断，多了循环补齐（1:1 还原前提下尽量尊重 blueprint 原题量）。
  const picked: BlueprintQuestion[] = []
  for (let i = 0; i < count; i += 1) {
    picked.push(source[i % source.length])
  }

  const raw = {
    title: `${grade}${subject} · ${blueprint.title}`,
    questions: picked.map((q, index) => {
      const saltBase = index + 1
      const content = rewriteQuestionText(q.content, saltBase)
      const options = q.options.map((o) => rewriteQuestionText(o, saltBase))
      const answer = rewriteQuestionText(q.answer, saltBase)
      const analysis = q.analysis ? rewriteQuestionText(q.analysis, saltBase) : undefined
      const topic = q.topic
      return {
        type: q.type,
        content,
        options,
        answer,
        ...(analysis ? { analysis } : {}),
        ...(topic ? { topic } : {}),
        points: q.points > 0 ? q.points : TYPE_DEFAULT_POINTS[q.type],
      }
    }),
  }

  const outcome = validatePaper(raw, true)
  if (!outcome.ok || outcome.value === null) {
    // 校验失败几乎只在「answer 字母对不上选项」时发生（源文档答案写错）。
    // 兜底：逐题用 resolveChoiceAnswer 宽容归一，仍失败就保留原答案文字。
    const fixed = picked.map((q, i) => {
      if (q.type === 'choice' || q.type === 'multi') {
        const resolved = resolveChoiceAnswer(q.answer, q.options, q.type === 'multi')
        if (!resolved.error) return { ...raw.questions[i], answer: resolved.letter ?? q.answer }
      }
      return raw.questions[i]
    })
    const retry = validatePaper({ ...raw, questions: fixed }, true)
    if (retry.ok && retry.value !== null) {
      return { ...retry.value, meta: buildMeta(retry.value, grade, subject, opts.difficulty) }
    }
    // 实在校验不过也给出可用卷：把 answer 清空，交给 validatePaper(requireAnswer=false)。
    const loose = validatePaper(raw, false)
    if (loose.ok && loose.value !== null) {
      return { ...loose.value, meta: buildMeta(loose.value, grade, subject, opts.difficulty) }
    }
    throw new Error('模仿出卷校验失败，请检查源文档题目结构')
  }

  return { ...outcome.value, meta: buildMeta(outcome.value, grade, subject, opts.difficulty) }
}

function buildMeta(paper: PaperResult, grade: string, subject: string, difficulty?: MimicOptions['difficulty']): PaperResult['meta'] {
  const total = paper.questions.reduce((sum, q) => sum + (q.points || 0), 0)
  return {
    grade,
    subject,
    difficulty: difficulty ?? '中等',
    scope: '1:1 模仿卷',
    label: '1:1 模仿卷',
    minutes: Math.min(120, Math.max(45, Math.round(paper.questions.length * 3))),
    totalPoints: total,
  }
}

/** 组合入口：识别 → 改数字 → 出卷。 */
export function mimicFromDocument(sourceText: string, opts: MimicOptions = {}): PaperResult {
  const blueprint = parseBlueprint(sourceText)
  return buildMimicPaper(blueprint, opts)
}
