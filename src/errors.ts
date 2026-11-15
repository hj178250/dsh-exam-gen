// QuizError — 唯一的错误类型。前端只渲染 message，永不展示 raw stack。
export type QuizErrorCode =
  | 'NO_MODEL'
  | 'LLM_FAILED'
  | 'BAD_JSON'
  | 'BAD_PARAMS'
  | 'INVALID_OUTPUT'
  | 'RETRIEVE_FAILED'
  | 'BANK_MISS'

export class QuizError extends Error {
  readonly code: QuizErrorCode
  /** 可以直接给用户看的一句话。 */
  readonly userMessage: string

  constructor(code: QuizErrorCode, userMessage: string, detail?: unknown) {
    super(detail === undefined ? userMessage : `${userMessage} :: ${stringify(detail)}`)
    this.name = 'QuizError'
    this.code = code
    this.userMessage = userMessage
  }
}

function stringify(detail: unknown): string {
  if (typeof detail === 'string') return detail
  try {
    return JSON.stringify(detail)
  } catch {
    return String(detail)
  }
}
