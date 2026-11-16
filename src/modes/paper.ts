// 智能组卷（mode = 'paper'）：参数规范化 → 组装短 Prompt → 校验。
import { QuizError } from '../errors.js'
import type { RetrieveHit } from '../retrieve.js'
import { anchorsFor } from '../style-anchors.js'
import {
  specFor,
  totalCount,
  expandScope,
  scoreSequence,
  blueprintFor,
  blueprintLines,
  sectionPoints,
  type SectionSpec,
  type SpecQuestionType,
  type BlueprintSlot,
} from '../exam-spec.js'

export const QUESTION_TYPES = ['choice', 'multi', 'fill', 'solve'] as const
export type QuestionType = (typeof QUESTION_TYPES)[number]

/** 选择题（单选/多选）才带 options。 */
export function isChoiceLike(type: QuestionType): boolean {
  return type === 'choice' || type === 'multi'
}

export interface PaperParams {
  grade: string
  subject: string
  scope: string
  count: number
  difficulty: '基础' | '中等' | '拔高'
  types: QuestionType
  withAnswer: boolean
  /** 卷面板块结构（选择/多选/填空/解答各几道、每题几分）。空则退回单题型。 */
  sections?: SectionSpec[]
  /** 逐题分值序列，长度 = count。由 sections 展开而来，用于校准每题分数。 */
  scores?: number[]
  /** 逐题考点骨架，长度 = count。有骨架时模型只填题不出结构。 */
  blueprint?: BlueprintSlot[]
}

export interface PaperQuestion {
  type: QuestionType
  content: string
  options: string[]
  /** 选择题存选项字母（A/B/C…，多选如 ABD），填空与解答题存答案原文。甲方 D3 已定。 */
  answer: string
  /** 选择题由字母反查出的选项原文；填空与解答题等于 answer。 */
  answerText: string
  points: number
  analysis?: string
  /** 考点（来自骨架；教材同步也用来标注知识点）。 */
  topic?: string
  /** 教材同步用：基础题区 / 提高题区。其它模板不填。 */
  tier?: 'basic' | 'advanced'
}

export interface PaperResult {
  title: string
  questions: PaperQuestion[]
  /** 卷面小字用的元信息（不参与标题，避免标题被「中等」「选择题」堆满）。 */
  meta?: {
    grade?: string
    subject?: string
    difficulty?: string
    scope?: string
    /** 卷面类型名，如「高考数学新课标卷」。 */
    label?: string
    minutes?: number
    totalPoints?: number
  }
}

const DEFAULT_SCOPE: Record<string, string> = {
  数学: '本学期核心章节',
  物理: '本学期核心章节',
  化学: '本学期核心章节',
  生物: '本学期核心章节',
}

/** 没说范围时的默认值：高中按高考全范围（有考点骨架），初中按本学期核心章节。 */
function defaultScope(grade: string, subject: string): string {
  return /高一|高二|高三|高中/.test(grade) ? '高考全范围' : DEFAULT_SCOPE[subject] ?? '本学期核心章节'
}

/** 全部字段带默认值，无空白项：用户不调任何东西直接确定也能跑。 */
export function normalizePaperParams(raw: Record<string, unknown> | undefined): PaperParams {
  const input = raw ?? {}
  const subject = text(input.subject) ?? '数学'
  const grade = text(input.grade) ?? '初一'
  const typeRaw = text(input.types) ?? text(input.type) ?? 'choice'
  const spec = specFor(grade, subject)
  const full = totalCount(spec)
  const count = clampInt(input.count, 1, 60, full)
  const scope = text(input.scope) ?? defaultScope(grade, subject)
  // 只有「按完整卷面出、且没说具体册别」时才逐题对分值/考点。
  // 说了「必修一」就不能套整份高考骨架——骨架是覆盖高中全部内容的，会跟册别打架。
  const scopeIsWhole = scope === defaultScope(grade, subject) || /高考|全部|综合|整个高中/.test(scope)
  const fullSheet = count === full && scopeIsWhole
  const blueprint = fullSheet ? blueprintFor(grade, subject) : []
  return {
    grade,
    subject,
    scope,
    count,
    difficulty: difficulty(input.difficulty),
    types: (QUESTION_TYPES as readonly string[]).includes(typeRaw) ? (typeRaw as QuestionType) : 'choice',
    withAnswer: input.withAnswer === undefined ? true : input.withAnswer !== false,
    sections: spec.sections,
    scores: fullSheet ? scoreSequence(spec) : undefined,
    blueprint: blueprint.length === count ? blueprint : undefined,
  }
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

function difficulty(value: unknown): PaperParams['difficulty'] {
  const raw = text(value)
  if (raw === '基础' || raw === '中等' || raw === '拔高') return raw
  if (raw === 'easy') return '基础'
  if (raw === 'hard') return '拔高'
  return '中等'
}

const TYPE_LABEL: Record<QuestionType, string> = {
  choice: '单选题',
  multi: '多选题',
  fill: '填空题',
  solve: '解答题',
}

const SHAPE_HINT = `{"title":"卷名","questions":[{"type":"choice|multi|fill|solve","content":"题干","options":["选项原文"],"answer":"A","points":5,"analysis":"解析"}]}`

const LETTER_LIMIT = 26

/** 把板块结构渲染成一行人话，含不均分分值。 */
function describeSections(sections: SectionSpec[]): string {
  const parts = sections.map((section) => {
    const uneven = section.points && section.points.length === section.count
    const detail = uneven ? `每题 ${section.points!.join('/')} 分` : `每题 ${section.pointsEach} 分`
    return `${TYPE_LABEL[section.type]} ${section.count} 道（${detail}）`
  })
  return parts.join('；')
}

/**
 * 组装 Prompt。刻意做短：一个角色句 + 参数行 + 输出结构 + 硬规则 + 最多 2 条风格参考。
 * repair 非空时进入重试分支，把上次的错误原样回喂。
 */
export function buildPaperPrompt(params: PaperParams, hits: RetrieveHit[], repair?: string[]): string {
  const lines: string[] = []
  const sections = params.sections
  const blueprint = params.blueprint
  const scores = params.scores

  if (sections && sections.length > 0) {
    const totalPoints = sections.reduce((sum, section) => sum + sectionPoints(section), 0)
    lines.push(
      `你是${params.grade}${params.subject}老师，出一套完整的${params.subject}试卷（${params.scope}）。只输出 JSON，不要解释、不要 Markdown 围栏。`,
    )
    lines.push(`卷面结构：${describeSections(sections)}。共 ${params.count} 题、满分 ${totalPoints} 分、难度 ${params.difficulty}。`)
    lines.push(`type 字段按题目所属板块填 choice / multi / fill / solve；choice 与 multi 要给 options，填空和解答题的 options 给空数组。`)
    // 把「必修一」这类册别展开成具体章节塞进 prompt。不写这一行，模型会凭印象出成别的册
    // （实测：说必修一，它出的是向量、解三角形这些必修二内容）。
    const chapters = expandScope(params.scope)
    if (chapters.length > 0 && chapters[0] !== params.scope) {
      lines.push(`本卷考查范围（严格限在这些章节内，一题都不要超纲）：${chapters.join('、')}。`)
    }
    if (blueprint && blueprint.length === params.count) {
      // 骨架分支：逐题考点、分值、难度全部写死，模型只负责把每一格填成题目。
      // 这是省 token 的主线——模型不用规划卷面、不用想分值、不用纠结考什么。
      lines.push(...blueprintLines(blueprint, scores ?? []))
      lines.push(`严格输出 ${params.count} 题，顺序与上表对应，points 填上表分值，不要改。`)
    } else if (scores && scores.length === params.count) {
      lines.push(`逐题分值（按顺序，共 ${params.count} 题）：${scores.join('、')}。`)
      lines.push(`严格输出 ${params.count} 题，points 按上面分值依次填，不要改。`)
    } else {
      lines.push(`严格输出 ${params.count} 题。`)
    }
  } else {
    lines.push(`你是${params.grade}${params.subject}老师，出一套${TYPE_LABEL[params.types]}。只输出 JSON，不要解释、不要 Markdown 围栏。`)
    lines.push(
      `参数：范围=${params.scope}；数量=${params.count}；难度=${params.difficulty}；每题分值=${params.types === 'solve' ? 10 : params.types === 'multi' ? 6 : 5}`,
    )
  }

  lines.push(`结构：${SHAPE_HINT}`)
  lines.push(
    `规则：type 只能 choice/multi/fill/solve；choice 的 answer 只填一个字母（A、B…），multi 填两个以上字母连写升序（如 ABD）；choice 与 multi 的 options 至少 4 项、只写原文不加"A."前缀；fill 与 solve 的 options 给空数组、answer 写答案原文；answer 不能为空；points 是正整数；不许超纲。`,
  )
  lines.push(
    `问法要像真卷：条件写全（数字、单位、图形关系），能带情境就带（"某班""某商店"）；禁止"下列说法正确的是哪一个""下列式子中是方程的是"这类空转辨析，禁止"是哪一个"收尾，改用"求…的值""则…是（  ）""…的值是______"。解答题若有多问，按"(1) …；(2) …"分点写，每问独立成段（用换行分隔），不要挤在同一行。`,
  )
  if (params.withAnswer) lines.push('答案与解析照常给出（answer、analysis 字段填满）。')
  else lines.push('answer 字段留空串，analysis 字段写空串（导出时由本地生成答案页）。')

  // 风格锚优先用插件内置的真题（固定、不随题库变化）；没有覆盖的学科才用检索结果
  const anchors = anchorsFor(params.subject, params.grade, 2)
  if (anchors.length > 0) {
    lines.push('卷面范例（学它的问法与信息密度，不要照抄题目、不要重复它的数字）：')
    anchors.forEach((anchor, index) => {
      lines.push(`${index + 1}) ${anchor.stem}`)
    })
  } else if (hits.length > 0) {
    lines.push('风格参考（只借难度与句式，不要照抄、不要改数字照搬）：')
    hits.forEach((hit, index) => {
      lines.push(`${index + 1}) ${hit.content}`)
    })
  }

  if (repair && repair.length > 0) {
    lines.push(`上次输出不合格：${repair.join('；')}。请修正后只输出 JSON。`)
  }
  return lines.join('\n')
}

export interface ValidationOutcome {
  ok: boolean
  errors: string[]
  value: PaperResult | null
}

/**
 * 选择题答案归一化（甲方 D3：answer 存字母，校验时反查选项）。
 * 单选：单字母按序号反查选项原文，越界即报错；模型偶尔仍写选项原文，宽容归一。
 * 多选：多个字母连写（ABD）或分隔（A、B、D），统一归一成升序字母串。
 */
export function resolveChoiceAnswer(
  raw: string,
  options: string[],
  multi = false,
): { letter?: string; text?: string; error?: string } {
  const trimmed = raw.trim()
  if (!multi) {
    if (/^[A-Za-z]$/.test(trimmed)) {
      const index = trimmed.toUpperCase().charCodeAt(0) - 65
      if (index >= options.length) {
        return { error: `的答案字母 ${trimmed.toUpperCase()} 超出选项数量（共 ${options.length} 项）` }
      }
      return { letter: trimmed.toUpperCase(), text: options[index] }
    }
    const matched = options.findIndex((option) => option.trim() === trimmed)
    if (matched >= 0) return { letter: String.fromCharCode(65 + matched), text: options[matched] }
    return { error: '的 answer 既不是选项字母也不在选项原文里' }
  }

  const letters = Array.from(new Set(trimmed.toUpperCase().replace(/[^A-Z]/g, '').split('')))
  if (letters.length < 2) return { error: `是多选题但只给了 ${letters.length} 个答案字母（至少要 2 个）` }
  for (const letter of letters) {
    if (letter.charCodeAt(0) - 65 >= options.length) {
      return { error: `的答案字母 ${letter} 超出选项数量（共 ${options.length} 项）` }
    }
  }
  const sorted = letters.sort()
  return { letter: sorted.join(''), text: sorted.map((letter) => options[letter.charCodeAt(0) - 65]).join(' / ') }
}

/** 委托书第七节的智能组卷校验规则，逐条落地。 */
export function validatePaper(raw: unknown, requireAnswer = true, params?: PaperParams): ValidationOutcome {
  const errors: string[] = []
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['顶层必须是 JSON 对象'], value: null }
  }
  const root = raw as Record<string, unknown>
  const title = text(root.title) ?? '未命名试卷'
  const list = Array.isArray(root.questions) ? root.questions : []
  if (list.length === 0) errors.push('questions 为空')

  const defaults = defaultPointsByType(params)
  const questions: PaperQuestion[] = []
  list.forEach((item, index) => {
    const label = `第${index + 1}题`
    if (typeof item !== 'object' || item === null) {
      errors.push(`${label}不是对象`)
      return
    }
    const row = item as Record<string, unknown>
    const type = text(row.type)
    if (!type || !(QUESTION_TYPES as readonly string[]).includes(type)) {
      errors.push(`${label}的 type 不在 choice/multi/fill/solve 之内`)
      return
    }
    const content = text(row.content)
    if (!content) {
      errors.push(`${label}缺少题干`)
      return
    }
    const options = Array.isArray(row.options) ? row.options.filter((opt): opt is string => typeof opt === 'string') : []
    const answerRaw = text(row.answer)
    let answer = answerRaw ?? ''
    let answerText = answer

    if (isChoiceLike(type as QuestionType)) {
      if (options.length < 2) errors.push(`${label}是选择题但选项少于 2 项`)
      else if (options.length > LETTER_LIMIT) errors.push(`${label}选项超过 26 项`)
      else if (!answerRaw) {
        if (requireAnswer) errors.push(`${label}答案为空`)
      } else {
        const resolved = resolveChoiceAnswer(answerRaw, options, type === 'multi')
        if (resolved.error !== undefined) errors.push(`${label}${resolved.error}`)
        else {
          answer = resolved.letter as string
          answerText = resolved.text as string
        }
      }
    } else if (!answerRaw) {
      if (requireAnswer) errors.push(`${label}答案为空`)
    }

    // 分值：优先用卷面规格逐题分值（sections/scores），其次模型给的，最后按题型缺省。
    const specScore = params?.scores?.[index]
    const pointsRaw = typeof row.points === 'number' ? row.points : Number.parseInt(String(row.points ?? ''), 10)
    const modelScore = Number.isFinite(pointsRaw) && pointsRaw > 0 ? Math.trunc(pointsRaw) : undefined
    const points = specScore && specScore > 0 ? specScore : modelScore ?? defaults[type as QuestionType]

    const topic = text(row.topic) ?? params?.blueprint?.[index]?.topic
    questions.push({
      type: type as QuestionType,
      content,
      options,
      answer,
      answerText,
      points,
      ...(text(row.analysis) === undefined ? {} : { analysis: text(row.analysis) as string }),
      ...(topic === undefined ? {} : { topic }),
    })
  })

  if (errors.length > 0) return { ok: false, errors, value: null }
  const spec = params ? specFor(params.grade, params.subject) : undefined
  return {
    ok: true,
    errors: [],
    value: {
      title,
      questions,
      ...(params === undefined || spec === undefined
        ? {}
        : {
            meta: {
              grade: params.grade,
              subject: params.subject,
              difficulty: params.difficulty,
              scope: params.scope,
              label: spec.label,
              minutes: spec.minutes,
              totalPoints: spec.totalPoints,
            },
          }),
    },
  }
}

/** 各题型的缺省分值，统一口径（旧版 solve=10 与 prompt 的 15 打架）。 */
function defaultPointsByType(params?: PaperParams): Record<QuestionType, number> {
  const out: Record<QuestionType, number> = { choice: 5, multi: 6, fill: 5, solve: 12 }
  for (const section of params?.sections ?? []) {
    out[section.type as QuestionType] = section.pointsEach
  }
  return out
}

/** 交付前的最后一道自检：数量是否达标（不作为重试理由，只记录）。 */
export function countGap(params: PaperParams, result: PaperResult): string | null {
  if (result.questions.length === params.count) return null
  return `模型给了 ${result.questions.length} 题，参数要求 ${params.count} 题`
}

export function assertPaper(value: unknown, params?: PaperParams): PaperResult {
  const outcome = validatePaper(value, true, params)
  if (!outcome.ok || outcome.value === null) {
    throw new QuizError('INVALID_OUTPUT', '生成的题目没有通过校验', outcome.errors)
  }
  return outcome.value
}

/** 骨架里 type 的分布是否与卷面规格一致（诊断用）。 */
export function blueprintMatchesSpec(slots: BlueprintSlot[], sections: SectionSpec[]): boolean {
  if (slots.length !== sections.reduce((sum, section) => sum + section.count, 0)) return false
  let cursor = 0
  for (const section of sections) {
    for (let i = 0; i < section.count; i += 1) {
      if (slots[cursor]?.type !== (section.type as SpecQuestionType)) return false
      cursor += 1
    }
  }
  return true
}
