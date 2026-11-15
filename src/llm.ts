// 模型调用层：只依赖 ctx.llm 的公开契约，不引入 dsh-llm 包（省依赖、免版本重复）。
import { QuizError } from './errors.js'

export interface LlmChunk {
  type: string
  text?: string
  reason?: { kind: string; failure?: { code?: string; message?: string } }
  usage?: unknown
}

export interface LlmLike {
  listProviders(): Array<{ id: string; displayName?: string }>
  listModels(provider: string): Promise<Array<{ id: string; name?: string }>>
  stream(options: {
    provider: string
    model: string
    messages: Array<{ role: 'user'; content: Array<{ type: 'text'; text: string }> }>
  }): AsyncIterable<LlmChunk>
}

/** DSH 自带的「默认模型」设置服务（零配置的真相来源）。 */
export interface DefaultModelLike {
  currentSelection(): { provider: string; model: string }
}

export interface ModelRoute {
  provider: string
  model: string
}

/**
 * 解析要用的 provider/model（甲方已定方案 A：四级下降，全部失败才报错）：
 *   1. 工具入参（用户/模型显式指定）
 *   2. 环境变量 DSH_EXAM_PROVIDER / DSH_EXAM_MODEL
 *   3. DSH 自己的默认模型设置 ctx.get('agentDefaultModel')
 *   4. 任一「确实公布了模型」的提供方，取它的第一个模型
 * 每一级候选都要被 listModels() 证实，避免选到没有凭据的空路由。
 */
export async function resolveRoute(
  llm: LlmLike,
  defaults: DefaultModelLike | undefined,
  provider?: string,
  model?: string,
): Promise<ModelRoute> {
  const providerIds = llm.listProviders().map((entry) => entry.id)
  if (providerIds.length === 0) throw new QuizError('NO_MODEL', '请先在 DSH 配置模型')

  const modelCache = new Map<string, string[]>()
  const modelsOf = async (id: string): Promise<string[]> => {
    const cached = modelCache.get(id)
    if (cached) return cached
    const ids = (await llm.listModels(id)).map((entry) => entry.id)
    modelCache.set(id, ids)
    return ids
  }

  const candidates: Array<{ provider?: string; model?: string }> = []
  if (provider) candidates.push({ provider, model })
  candidates.push({ provider: process.env.DSH_EXAM_PROVIDER, model: process.env.DSH_EXAM_MODEL })
  if (defaults) {
    try {
      const current = defaults.currentSelection()
      candidates.push({ provider: current.provider, model: current.model })
    } catch {
      // 设置服务读不到值：当作没有默认值，继续下降。
    }
  }
  for (const id of providerIds) candidates.push({ provider: id })

  for (const candidate of candidates) {
    if (!candidate.provider || !providerIds.includes(candidate.provider)) continue
    const models = await modelsOf(candidate.provider)
    if (models.length === 0) continue
    const chosen = candidate.model && models.includes(candidate.model) ? candidate.model : models[0]
    return { provider: candidate.provider, model: chosen }
  }

  throw new QuizError(
    'NO_MODEL',
    '请先在 DSH 配置模型',
    '没有任何提供方可用（设置 → 模型，或设置 DSH_EXAM_PROVIDER/DSH_EXAM_MODEL）',
  )
}

export interface ModelCallResult {
  text: string
  finish: string
  errorCode: string
  usage: { inputTokens?: number; outputTokens?: number } | undefined
}

/** 一次纯文本模型调用，返回拼接后的文本与终止原因。 */
export async function callModelText(llm: LlmLike, route: ModelRoute, prompt: string): Promise<ModelCallResult> {
  let text = ''
  let finish = 'stop'
  let errorCode = ''
  let usage: ModelCallResult['usage']
  for await (const chunk of llm.stream({
    provider: route.provider,
    model: route.model,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
  })) {
    if (chunk.type === 'text-delta') text += chunk.text ?? ''
    else if (chunk.type === 'usage') usage = chunk.usage as ModelCallResult['usage']
    else if (chunk.type === 'finish') {
      finish = chunk.reason?.kind ?? 'stop'
      errorCode = chunk.reason?.failure?.code ?? ''
    }
  }
  if (errorCode !== '') {
    throw new QuizError('LLM_FAILED', `模型调用失败（${errorCode}），请稍后重试`, errorCode)
  }
  return { text, finish, errorCode, usage }
}

/** 从模型输出里抠出第一个 JSON 对象/数组，容忍 ```json 围栏与前后废话。 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim()
  const fenceless = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim()
  const direct = tryParse(fenceless)
  if (direct !== undefined) return direct

  const start = fenceless.search(/[[{]/)
  if (start >= 0) {
    const open = fenceless[start]
    const close = open === '{' ? '}' : ']'
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < fenceless.length; i += 1) {
      const ch = fenceless[i]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === open) depth += 1
      else if (ch === close) {
        depth -= 1
        if (depth === 0) {
          const sliced = tryParse(fenceless.slice(start, i + 1))
          if (sliced !== undefined) return sliced
          break
        }
      }
    }
  }
  throw new QuizError('BAD_JSON', '模型没有按 JSON 格式返回，已自动重试一次仍失败', text.slice(0, 200))
}

function tryParse(candidate: string): unknown {
  try {
    return JSON.parse(candidate)
  } catch {
    return undefined
  }
}
