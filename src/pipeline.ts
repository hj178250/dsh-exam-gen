// 生成流水线：题库直出（零调用）→ 不够再走 本地检索 → 短 Prompt → 模型 → 校验 → 重试一次。
import { QuizError } from './errors.js'
import { callModelText, extractJson, resolveRoute, type DefaultModelLike, type LlmLike, type ModelRoute } from './llm.js'
import { composeFromBank, composeSync } from './modes/paper-bank.js'
import { normalizeSyncParams } from './modes/sync.js'
import {
  buildPaperPrompt,
  countGap,
  normalizePaperParams,
  validatePaper,
  type PaperQuestion,
} from './modes/paper.js'
import { getBank, retrieveReferences, seedDir, dshHome, type RetrieveHit } from './retrieve.js'
import { absorbGeneratedQuestions, bankFilePath, persistentBankPath } from './bank-write.js'
import { expandScope, specFor } from './exam-spec.js'
import {
  buildLessonPrompt,
  validateLessonModel,
  type LessonModelOutput,
  type LessonModelParams,
} from './modes/lesson-model.js'

/** 卷名统一由插件拼：范围为空时叫单元测试卷，混合来源加个后缀。 */
function buildPaperTitle(params: { grade: string; subject: string; scope: string }, mixed: boolean): string {
  const scope = params.scope.trim()
  const base = scope ? `${params.grade}${params.subject} · ${scope}` : `${params.grade}${params.subject} · 单元测试卷`
  return mixed ? `${base}（题库 + 生成）` : base
}
export interface GenerateMeta {
  provider: string
  model: string
  attempts: number
  retrieved: number
  countRequested: number
  countGot: number
  gap: string
  elapsedMs: number
  inputTokens: number
  outputTokens: number
  /** bank = 题库直出（零模型调用）；mixed = 题库补一部分 + 模型补差额；model = 全模型生成。 */
  origin: 'bank' | 'mixed' | 'model'
  /** 题库命中的章节，前端用来告诉用户「这些题从哪来」。 */
  chapters?: string[]
  /** 卷面规格名（如「高考数学新课标卷」），PDF 卷头小字用。 */
  label?: string
  /** 建议考试时长（分钟），PDF 卷头用。 */
  minutes?: number
  /** 卷面满分。 */
  totalPoints?: number
  /** 卷头小字：年级 / 学科 / 难度 / 范围。 */
  grade?: string
  subject?: string
  difficulty?: string
  scope?: string
}

export interface GenerateOutcome {
  mode: 'paper' | 'sync'
  title: string
  questions: PaperQuestion[]
  meta: GenerateMeta
  /** 教材同步专用：卷头要写的教材版本与课时。 */
  sync?: { textbook: string; lesson?: string; ratio: number }
}

export interface GenerateInput {
  mode?: string
  params?: Record<string, unknown>
  route?: { provider?: string; model?: string }
  /** auto（默认）= 题库够就直出；bank = 只用题库；model = 只用模型。 */
  source?: 'auto' | 'bank' | 'model'
}

const MAX_ATTEMPTS = 2

export async function generateContent(
  llm: LlmLike,
  defaults: DefaultModelLike | undefined,
  input: GenerateInput,
): Promise<GenerateOutcome> {
  const mode = input.mode ?? 'paper'

  // ——— 教材同步：只走本地题库（严格对应教材章节，不交给模型现编）———
  if (mode === 'sync') {
    const startedAt = Date.now()
    const syncParams = normalizeSyncParams(input.params)
    const index = await getBank()
    const composed = composeSync(index, syncParams)
    const questions = composed.result.questions
    if (questions.length === 0) {
      throw new QuizError('BANK_MISS', `题库里还没有「${syncParams.scope}」的同步题，换个章节或先往题库加题`, mode)
    }
    return {
      mode: 'sync',
      title: composed.result.title,
      questions,
      sync: {
        textbook: syncParams.textbook,
        lesson: String(input.params?.lesson ?? '').trim() || undefined,
        ratio: syncParams.ratio,
      },
      meta: {
        provider: '',
        model: '',
        attempts: 0,
        retrieved: questions.length,
        countRequested: syncParams.count,
        countGot: questions.length,
        gap: questions.length < syncParams.count ? `题库只凑到 ${questions.length} 道` : '',
        elapsedMs: Date.now() - startedAt,
        inputTokens: 0,
        outputTokens: 0,
        origin: 'bank',
        chapters: composed.chapters,
      },
    }
  }

  if (mode !== 'paper') {
    throw new QuizError('INVALID_OUTPUT', `功能 ${mode} 尚未接入（当前有 paper / sync）`, mode)
  }

  const startedAt = Date.now()
  const params = normalizePaperParams(input.params)
  const spec = specFor(params.grade, params.subject)
  // 甲方拍板 C+D：默认走「精品」（模型按真题风格生成），题库只是风格锚与兜底。
  // 想要 30ms 秒出、不要模型参与时，显式传 source='bank'。
  const source = input.source ?? 'model'

  // ——— 第一优先：题库直出（0 token、毫秒级）———
  let bankQuestions: PaperQuestion[] = []
  let bankChapters: string[] = []
  if (source !== 'model') {
    try {
      const index = await getBank()
      if (index.size > 0) {
        const composed = composeFromBank(index, params)
        bankQuestions = composed.result.questions
        bankChapters = composed.chapters
        if (source === 'bank' || bankQuestions.length >= params.count) {
          const sliced = bankQuestions.slice(0, params.count)
          return {
            mode: 'paper',
            title: composed.result.title,
            questions: sliced,
            meta: {
              provider: '',
              model: '',
              attempts: 0,
              retrieved: sliced.length,
              countRequested: params.count,
              countGot: sliced.length,
              gap: sliced.length < params.count ? `题库只凑到 ${sliced.length} 道` : '',
              elapsedMs: Date.now() - startedAt,
              inputTokens: 0,
              outputTokens: 0,
              origin: 'bank',
              chapters: bankChapters,
              label: spec.label,
              minutes: spec.minutes,
              totalPoints: spec.totalPoints,
              grade: params.grade,
              subject: params.subject,
              difficulty: params.difficulty,
              scope: params.scope,
            },
          }
        }
      }
    } catch {
      // 题库不可用不阻塞：直接走模型
      bankQuestions = []
    }
  }

  const route: ModelRoute = await resolveRoute(llm, defaults, input.route?.provider, input.route?.model)

  // ——— 第二优先：题库补一部分，模型只补差额 ———
  const needCount = Math.max(1, params.count - bankQuestions.length)
  // 题库补题时，逐题分值/考点骨架跟题目下标就错位了，直接弃用，让模型自由补差额。
  const modelParams =
    bankQuestions.length === 0
      ? params
      : { ...params, count: needCount, scores: undefined, blueprint: undefined }

  let hits: RetrieveHit[] = []
  try {
    // 「初一上册」「高一必修一」这类范围，展开成具体章节再检索，否则题库里存的
    // 「七上 第一章 有理数」根本匹配不到「初一上册」这四个字。
    const scopeKeywords = expandScope(params.scope).join(' ')
    hits = await retrieveReferences({
      grade: params.grade,
      subject: params.subject,
      scope: scopeKeywords || params.scope,
      difficulty: params.difficulty,
      // 风格锚要够用：给 3 道（检索层会优先挑真题来源），比 2 道更能把问法带正
      limit: 3,
    })
  } catch {
    // 检索失败不阻塞出题：降级为无参考题。
    hits = []
  }

  let repair: string[] | undefined
  let lastErrors: string[] = []
  let inputTokens = 0
  let outputTokens = 0

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const prompt = buildPaperPrompt(modelParams, hits, repair)
    const reply = await callModelText(llm, route, prompt)
    inputTokens += reply.usage?.inputTokens ?? 0
    outputTokens += reply.usage?.outputTokens ?? 0

    let parsed: unknown
    try {
      parsed = extractJson(reply.text)
    } catch (error) {
      lastErrors = [error instanceof QuizError ? error.userMessage : '模型没有返回 JSON']
      repair = lastErrors
      continue
    }

    // 校验用的参数：题库没参与时用完整 params（逐题分值/考点骨架对得上）；
    // 题库补过题时下标会错位，改用 modelParams，避免把第 1 题的 5 分套到补的第 1 道上。
    const validationParams = bankQuestions.length === 0 ? params : modelParams
    const outcome = validatePaper(parsed, params.withAnswer, validationParams)
    if (outcome.ok && outcome.value !== null) {
      const generated = outcome.value.questions
      const merged = bankQuestions.length ? [...bankQuestions, ...generated].slice(0, params.count) : generated
      const gap = countGap(params, { title: outcome.value.title, questions: merged })

      // 无感回写：把模型新编的题悄悄沉淀进本地题库，库越用越大。
      // 只沉淀「纯模型/差额新编」的题（题库直出的那些本来就在库里，不重复写）。
      // fire-and-forget：不 await，绝不让写盘拖慢本次出卷；absorb 内部全 catch，永不抛。
      if (generated.length > 0) {
        void absorbGeneratedQuestions(
          bankFilePath(seedDir()),
          persistentBankPath(dshHome()),
          {
            grade: params.grade,
            subject: params.subject,
            scope: params.scope,
            difficulty: params.difficulty,
          },
          generated,
        ).catch(() => {})
      }
      return {
        mode: 'paper',
        // 标题统一由插件拼：模型的 title 会写成「一元一次方程中等难度单选题」这种，不像卷名
        title: buildPaperTitle(params, bankQuestions.length > 0),
        questions: merged,
        meta: {
          provider: route.provider,
          model: route.model,
          attempts: attempt,
          retrieved: hits.length,
          countRequested: params.count,
          countGot: merged.length,
          gap: gap ?? '',
          elapsedMs: Date.now() - startedAt,
          inputTokens,
          outputTokens,
          origin: bankQuestions.length ? 'mixed' : 'model',
          chapters: bankChapters,
          label: outcome.value.meta?.label,
          minutes: outcome.value.meta?.minutes,
          totalPoints: outcome.value.meta?.totalPoints,
          grade: params.grade,
          subject: params.subject,
          difficulty: params.difficulty,
          scope: params.scope,
        },
      }
    }
    lastErrors = outcome.errors
    repair = lastErrors
  }

  throw new QuizError('INVALID_OUTPUT', '生成的题目没有通过校验（已自动重试一次）', lastErrors)
}

/** 讲义走大模型：题库那批是诊断题，直接搬进讲义太干，这里让模型按讲义骨架写 */
export async function generateLesson(
  llm: LlmLike,
  defaults: DefaultModelLike | undefined,
  params: LessonModelParams,
  routeInput?: { provider?: string; model?: string },
): Promise<{
  value: LessonModelOutput
  meta: {
    provider: string
    model: string
    attempts: number
    inputTokens: number
    outputTokens: number
    elapsedMs: number
  }
}> {
  const startedAt = Date.now()
  const route: ModelRoute = await resolveRoute(llm, defaults, routeInput?.provider, routeInput?.model)

  let inputTokens = 0
  let outputTokens = 0
  let repair: string | undefined
  let lastError = ''

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const prompt = buildLessonPrompt(params) + (repair ? `\n\n上次输出不合格：${repair}\n请只输出修好的 JSON。` : '')
    const reply = await callModelText(llm, route, prompt)
    inputTokens += reply.usage?.inputTokens ?? 0
    outputTokens += reply.usage?.outputTokens ?? 0

    let parsed: unknown
    try {
      parsed = extractJson(reply.text)
    } catch (error) {
      lastError = error instanceof QuizError ? error.userMessage : '模型没有返回 JSON'
      repair = lastError
      continue
    }

    const checked = validateLessonModel(parsed)
    if (checked.ok) {
      return {
        value: checked.value,
        meta: {
          provider: route.provider,
          model: route.model,
          attempts: attempt,
          inputTokens,
          outputTokens,
          elapsedMs: Date.now() - startedAt,
        },
      }
    }
    lastError = checked.error
    repair = lastError
  }

  throw new QuizError('INVALID_OUTPUT', '讲义内容没通过校验（已自动重试一次）', [lastError])
}
