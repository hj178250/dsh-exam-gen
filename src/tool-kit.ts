/**
 * 最小工具定义助手 —— 刻意不依赖 @deepseek-ai/dsh-tools。
 *
 * 为什么：dsh-tools 是 DSH 运行时的**内部包**，版本跟运行时绑死（0.2.2-rc.1 / rc.3 …）。
 * 把它写成 dependencies，装包时 pnpm 会往 profile 里塞一份自己的版本，把运行时那份顶掉，
 * dsh 检测到版本不匹配就禁用 tools 服务，结果**整个 DSH 起不来**（实测：11 个插件等不到 tools）。
 *
 * 而 ctx.tools.register 真正需要的只是 `{ name, description, parameters(标准 JSON Schema),
 * output: { schema(标准 JSON Schema), render }, execute }` —— 所以这里自己拼就好。
 * 参数表用标准 JSON Schema 还有个副作用：比 DSL 更短，常驻成本更低。
 */

export interface JsonSchema {
  type?: string
  description?: string
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  required?: string[]
  enum?: unknown[]
  anyOf?: JsonSchema[]
  additionalProperties?: boolean
  minimum?: number
  maximum?: number
}

export interface ToolTextBlock {
  type: 'text'
  text: string
}

export interface ToolLike<A = Record<string, unknown>, R = unknown> {
  name: string
  description: string
  parameters: JsonSchema
  output: {
    schema: JsonSchema
    render: (args: A, value: R) => ToolTextBlock[]
  }
  timeoutMs?: number
  execute: (args: A, exec: unknown) => Promise<R>
}

/** 只是类型收窄，运行时原样返回。 */
export function defineTool<A = Record<string, unknown>, R = unknown>(options: ToolLike<A, R>): ToolLike<A, R> {
  return options
}
