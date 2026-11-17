// 题库管理页的服务端：往 DSH 自己的 webServer 上挂路由。
//
// 借鉴 dsh-tool-cards 的接线方式（它是同一套 API 的现成例子）：
//   ctx.inject(['webServer','connection'], () => webServer.register({ kind:'exact', path, handler }))
// 这里必须用 ctx.inject 而不是 ctx.effect：webServer 服务晚于本插件激活时，
// ctx.effect 里的 ctx.get('webServer') 会拿到 undefined，路由就永久丢了（dsh-tool-cards 0.2.2 踩过这个坑）。
//
// 关键约定（甲方需求 m12189②：用户可自己改题库）：
// 所有写操作（add / update / delete / import）都落到持久库
// `<DSH_HOME>/exam-gen-bank/bank.json`，绝不写随包只读的 `data/` 库。
// 读写统一复用 bank-write.ts 的去重(normKey)、原子写、.bak 备份与串行写锁。
import { randomBytes } from 'node:crypto'
import { ADMIN_API, ADMIN_PATH, adminPageHtml, PDF_PATH } from './admin-page.js'
import { recomputeSummary } from './bank-store.js'
import type { BankItem } from './bank.js'
import { getPdf } from './pdf-store.js'
import { CATALOG, EDITIONS, listEditions, listGrades, listBooksForEdition, listChaptersForEdition, listPointsForEdition } from './knowledge-catalog.js'
import { dshHome, seedDir } from './retrieve.js'
import { bankFilePath, ensureBankSeeded, mutateBank, normKey, persistentBankPath, readBankObj, type BankRead } from './bank-write.js'

const MAX_BODY_BYTES = 4 * 1024 * 1024

/** webServer 起来后把监听地址记下来，工具返回的下载链接要用绝对 URL。 */
let adminOrigin = ''

export function currentOrigin(): string {
  return adminOrigin
}

function resolveOrigin(webServer: unknown): string {
  const target = webServer as Record<string, unknown> | undefined
  if (!target) return ''
  const direct = target.origin ?? target.url ?? target.baseUrl
  if (typeof direct === 'string' && /^https?:\/\//.test(direct)) return direct.replace(/\/$/, '')
  const server = target.server as { address?: () => unknown } | undefined
  const address = typeof server?.address === 'function' ? server.address() : undefined
  if (address && typeof address === 'object' && 'port' in address) {
    const port = (address as { port?: number }).port
    if (port) return `http://127.0.0.1:${port}`
  }
  const port = Number(target.port ?? 0)
  if (port) return `http://127.0.0.1:${port}`
  return ''
}

interface WebServerLike {
  register(options: { kind: 'exact'; path: string; handler: (req: ReqLike, res: ResLike) => Promise<void> | void }): unknown
}

interface ReqLike {
  method?: string
  url?: string
  headers?: Record<string, string | string[] | undefined>
  [Symbol.asyncIterator]?: () => AsyncIterator<unknown>
}

interface ResLike {
  writeHead(status: number, headers: Record<string, string | number>): void
  end(body?: string | Buffer): void
}

interface ConnectionLike {
  requestRejection?(req: ReqLike): unknown
}

interface ContextLike {
  inject(deps: string[], factory: () => unknown): unknown
  get(name: string): unknown
  logger?(scope: string): { warn?(message: string): void; info?(message: string): void }
}

async function readJsonBody(req: ReqLike): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  const iterator = req[Symbol.asyncIterator]?.()
  if (!iterator) return {}
  for (;;) {
    const step = await iterator.next()
    if (step.done) break
    const chunk = Buffer.isBuffer(step.value) ? step.value : Buffer.from(String(step.value))
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) return {}
  return JSON.parse(text)
}

function sendJson(res: ResLike, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

function sendHtml(res: ResLike, status: number, html: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'cache-control': 'no-store',
  })
  res.end(html)
}

function sendText(res: ResLike, status: number, text: string, filename: string): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'no-store',
  })
  res.end(text)
}

function sendBinary(res: ResLike, status: number, buffer: Buffer, filename: string): void {
  res.writeHead(status, {
    'content-type': 'application/pdf',
    'content-length': buffer.length,
    'content-disposition': `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'cache-control': 'no-store',
  })
  res.end(buffer)
}

function queryOf(req: ReqLike): URLSearchParams {
  const raw = req.url ?? '/'
  const index = raw.indexOf('?')
  return new URLSearchParams(index >= 0 ? raw.slice(index + 1) : '')
}

/** 内存过滤：题库几千条全表扫一遍不到 1 ms，不必建索引。 */
export function filterItems(items: BankItem[], params: URLSearchParams): BankItem[] {
  const subject = params.get('subject') ?? ''
  const grade = params.get('grade') ?? ''
  const chapter = params.get('chapter') ?? ''
  const type = params.get('type') ?? ''
  const difficulty = params.get('difficulty') ?? ''
  const keyword = (params.get('keyword') ?? params.get('q') ?? '').trim().toLowerCase()
  return items.filter((item) => {
    if (subject && item.subject !== subject) return false
    if (grade && item.grade !== grade) return false
    if (chapter && !(item.chapter ?? '').includes(chapter)) return false
    if (type && item.type !== type) return false
    if (difficulty && item.difficulty !== difficulty) return false
    if (!keyword) return true
    const haystack = `${item.content ?? ''} ${item.chapter ?? ''} ${item.topic ?? ''} ${item.answerText ?? ''} ${item.answer ?? ''}`.toLowerCase()
    return haystack.includes(keyword)
  })
}

export interface AdminDeps {
  /** 题库目录（默认 <包根>/data，仅作为随包 seed 数据源，不再作为写目标）。 */
  dir: string
  /** 是否启用（DSH_EXAM_ADMIN=1 或配置项）。 */
  enabled: boolean
  /** 读当前插件开关（页面顶部那个开关用）。 */
  isOn?: () => boolean
  /** 切换插件开关，返回切换后的值。 */
  setOn?: (on: boolean) => boolean
}

/** 持久库路径（写目标），由 DSH_HOME 实时计算，不依赖 index.ts 传入的 seed dir。 */
function persistentFile(): string {
  return persistentBankPath(dshHome())
}

/** 随包 seed 数据源路径（仅首次 seed 用）。 */
function seedFile(): string {
  return bankFilePath(seedDir())
}

/** 读取持久库（首次访问自动从随包库 seed 一份，之后读到的都是持久库内容）。 */
async function loadPersistent(): Promise<BankRead> {
  const file = persistentFile()
  await ensureBankSeeded(seedFile(), file)
  return readBankObj(file)
}

/** 生成一条自定义题 id。 */
function newCustomId(index = 0): string {
  return `custom-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}${index ? `-${index}` : ''}`
}

/**
 * 注册题库管理页。返回页面地址（未启用时返回 undefined），方便在日志里打印给开发者。
 */
export function registerAdminPage(ctx: ContextLike, deps: AdminDeps): string | undefined {
  if (!deps.enabled) return undefined

  const token = randomBytes(16).toString('hex')
  const apiBase = ADMIN_API

  ctx.inject(['webServer', 'connection'], () => {
    const webServer = ctx.get('webServer') as WebServerLike | undefined
    if (!webServer) {
      ctx.logger?.('dsh-exam-gen')?.warn?.('webServer 不可用，题库管理页未挂载')
      return
    }
    const connection = ctx.get('connection') as ConnectionLike | undefined
    const hasGuard = typeof connection?.requestRejection === 'function'
    adminOrigin = resolveOrigin(webServer)
    console.log(
      `[dsh-exam-gen] webServer keys=${Object.keys(webServer as object).join(',')} origin=${adminOrigin || '(unknown)'}`,
    )
    const sameOrigin = (req: ReqLike): boolean => !hasGuard || connection?.requestRejection?.(req) === undefined
    const tokenOk = (req: ReqLike): boolean => {
      const header = req.headers?.['x-exam-token']
      const fromHeader = Array.isArray(header) ? header[0] : header
      if (fromHeader === token) return true
      return queryOf(req).get('token') === token
    }

    const pageRoute = webServer.register({
      kind: 'exact',
      path: ADMIN_PATH,
      handler: async (req, res) => {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        return sendHtml(res, 200, adminPageHtml(token, deps.isOn?.() !== false))
      },
    })

    // 插件总开关：页面顶部的那个按钮打到这里，改完立刻生效，不用重启
    const toggleRoute = webServer.register({
      kind: 'exact',
      path: `${apiBase}/toggle`,
      handler: async (req, res) => {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: '需要 POST' })
        let body: { enabled?: boolean } | undefined
        try {
          body = (await readJsonBody(req)) as { enabled?: boolean } | undefined
        } catch (error) {
          return sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : '请求体无法解析' })
        }
        const next = body?.enabled !== false
        const applied = deps.setOn ? deps.setOn(next) : next
        return sendJson(res, 200, { ok: true, enabled: applied })
      },
    })

    const statsRoute = webServer.register({
      kind: 'exact',
      path: `${apiBase}/stats`,
      handler: async (req, res) => {
        // 同源即可：侧栏面板靠它读「开/关」状态
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        const read = await loadPersistent()
        const summary = recomputeSummary(read.items)
        return sendJson(res, 200, {
          ok: true,
          enabled: deps.isOn?.() !== false,
          path: read.file,
          size: read.items.length,
          summary,
          license: read.obj.license,
          chapters: summary.chapters,
        })
      },
    })

    // 知识点目录（只读）：参数卡「学科→年级→册→章→知识点→题型」的级联数据源。
    // 走 HTTP 不走模型工具，浏览器 fetch 一次全量缓存，参数卡零延迟级联。
    const catalogRoute = webServer.register({
      kind: 'exact',
      path: `${apiBase}/catalog`,
      handler: async (req, res) => {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        const params = queryOf(req)
        const subject = params.get('subject') ?? ''
        const grade = params.get('grade') ?? ''
        const edition = params.get('edition') ?? ''
        const book = params.get('book') ?? ''
        const chapter = params.get('chapter') ?? ''

        // 顶层：全部学科 + 5 个版本
        if (!subject) {
          return sendJson(res, 200, {
            ok: true,
            subjects: CATALOG.map((s) => s.subject),
            editions: [...EDITIONS],
          })
        }
        // 学科已给但版本没给 → 只回该学科各年级 + 该学科实际开设的版本
        if (!edition) {
          return sendJson(res, 200, {
            ok: true,
            subject,
            grades: listGrades(subject),
            editions: listEditions(subject),
          })
        }
        // 有版本、有年级 → 回该年级的册别列表
        if (!book) {
          return sendJson(res, 200, { ok: true, subject, grade, edition, books: listBooksForEdition(subject, grade, edition) })
        }
        // 有册别 → 回章节列表
        if (!chapter) {
          return sendJson(res, 200, { ok: true, subject, grade, edition, book, chapters: listChaptersForEdition(subject, grade, book, edition) })
        }
        // 有章节 → 回知识点列表（含题型）
        return sendJson(res, 200, {
          ok: true, subject, grade, edition, book, chapter,
          points: listPointsForEdition(subject, grade, book, chapter, edition).map((pt) => ({ name: pt.name, types: pt.types })),
        })
      },
    })

    // 列题目：query 过滤 subject/grade/chapter/type/difficulty/keyword + 分页 limit/offset。
    const itemsRoute = webServer.register({
      kind: 'exact',
      path: `${apiBase}/items`,
      handler: async (req, res) => {
        if (!sameOrigin(req) || !tokenOk(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        const params = queryOf(req)
        const limit = Math.min(200, Math.max(1, Number(params.get('limit') ?? 50) || 50))
        const offset = Math.max(0, Number(params.get('offset') ?? 0) || 0)
        const read = await loadPersistent()
        const matched = filterItems(read.items, params)
        return sendJson(res, 200, {
          ok: true,
          total: matched.length,
          limit,
          offset,
          items: matched.slice(offset, offset + limit),
        })
      },
    })

    // 加题：body 为 BankItem（content 必填），写入持久库，去重（normKey），重复返回 skipped。
    const addRoute = webServer.register({
      kind: 'exact',
      path: `${apiBase}/add`,
      handler: async (req, res) => {
        if (!sameOrigin(req) || !tokenOk(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: '需要 POST' })
        let body: unknown
        try {
          body = await readJsonBody(req)
        } catch (error) {
          return sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : '请求体无法解析' })
        }
        const draft = (body ?? {}) as Partial<BankItem>
        const content = String(draft.content ?? '').trim()
        if (!content) return sendJson(res, 400, { ok: false, error: 'content 必填' })
        const key = normKey(content)
        if (!key) return sendJson(res, 400, { ok: false, error: '题干为空' })

        try {
          const result = await mutateBank(persistentFile(), seedFile(), (read) => {
            if (read.items.some((item) => normKey(item.content) === key)) {
              return { skipped: true, id: undefined as string | undefined, size: read.items.length }
            }
            const item: BankItem = {
              ...(draft as BankItem),
              id: draft.id || newCustomId(),
              content,
              source: draft.source ?? 'custom',
            }
            read.items.push(item)
            read.obj.items = read.items
            read.obj.summary = recomputeSummary(read.items)
            return { skipped: false, id: item.id, size: read.items.length }
          })
          if (result.skipped) return sendJson(res, 200, { ok: true, skipped: true, size: result.size })
          return sendJson(res, 200, { ok: true, skipped: false, id: result.id, size: result.size })
        } catch (error) {
          return sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : '写入失败' })
        }
      },
    })

    // 改题：body 含 id + 要改字段，按 id 定位合并（id 本身不可改）。
    const updateRoute = webServer.register({
      kind: 'exact',
      path: `${apiBase}/update`,
      handler: async (req, res) => {
        if (!sameOrigin(req) || !tokenOk(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: '需要 POST' })
        let body: unknown
        try {
          body = await readJsonBody(req)
        } catch (error) {
          return sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : '请求体无法解析' })
        }
        const draft = (body ?? {}) as Partial<BankItem> & { id?: string }
        const id = String(draft.id ?? '')
        if (!id) return sendJson(res, 400, { ok: false, error: '缺少 id' })

        try {
          const result = await mutateBank(persistentFile(), seedFile(), (read) => {
            const index = read.items.findIndex((item) => item.id === id)
            if (index < 0) return { ok: false, size: read.items.length }
            const { id: _ignored, ...fields } = draft
            const merged: BankItem = { ...read.items[index], ...(fields as Partial<BankItem>) }
            merged.id = id
            if (!String(merged.content ?? '').trim()) return { ok: false, size: read.items.length }
            read.items[index] = merged
            read.obj.items = read.items
            read.obj.summary = recomputeSummary(read.items)
            return { ok: true, size: read.items.length }
          })
          if (!result.ok) return sendJson(res, 400, { ok: false, error: '没有这道题或题干为空' })
          return sendJson(res, 200, { ok: true, size: result.size })
        } catch (error) {
          return sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : '写入失败' })
        }
      },
    })

    // 删题：按 id 删除持久库条目（持久库属用户，允许删任意一条）。
    const deleteRoute = webServer.register({
      kind: 'exact',
      path: `${apiBase}/delete`,
      handler: async (req, res) => {
        if (!sameOrigin(req) || !tokenOk(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: '需要 POST' })
        const body = (await readJsonBody(req).catch(() => ({}))) as { id?: string }
        if (!body?.id) return sendJson(res, 400, { ok: false, error: '缺少 id' })
        try {
          const result = await mutateBank(persistentFile(), seedFile(), (read) => {
            const index = read.items.findIndex((item) => item.id === body.id)
            if (index < 0) return { ok: false, size: read.items.length }
            read.items.splice(index, 1)
            read.obj.items = read.items
            read.obj.summary = recomputeSummary(read.items)
            return { ok: true, size: read.items.length }
          })
          if (!result.ok) return sendJson(res, 400, { ok: false, error: '没有这道题' })
          return sendJson(res, 200, { ok: true, size: result.size })
        } catch (error) {
          return sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : '写入失败' })
        }
      },
    })

    // 导入：body 为 JSON 数组或 {items:[]}，merge 进持久库（去重 + 原子写 + .bak）。
    const importRoute = webServer.register({
      kind: 'exact',
      path: `${apiBase}/import`,
      handler: async (req, res) => {
        if (!sameOrigin(req) || !tokenOk(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: '需要 POST' })
        let body: unknown
        try {
          body = await readJsonBody(req)
        } catch (error) {
          return sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : '请求体无法解析' })
        }
        const incoming: unknown[] = Array.isArray(body)
          ? body
          : Array.isArray((body as { items?: unknown[] })?.items)
            ? ((body as { items?: unknown[] }).items as unknown[])
            : []
        if (!incoming.length) return sendJson(res, 400, { ok: false, error: 'items 必须是数组且不能为空' })
        if (incoming.length > 500) return sendJson(res, 400, { ok: false, error: '单次最多导入 500 道' })

        try {
          const result = await mutateBank(persistentFile(), seedFile(), (read) => {
            const seen = new Set(read.items.map((item) => normKey(item.content)))
            let added = 0
            let skipped = 0
            for (let i = 0; i < incoming.length; i += 1) {
              const raw = incoming[i] as Partial<BankItem> | undefined
              const content = String(raw?.content ?? '').trim()
              if (!content) { skipped += 1; continue }
              const key = normKey(content)
              if (!key || seen.has(key)) { skipped += 1; continue }
              seen.add(key)
              const item: BankItem = {
                ...(raw as BankItem),
                id: raw?.id || newCustomId(i),
                content,
                source: raw?.source ?? 'custom',
              }
              read.items.push(item)
              added += 1
            }
            read.obj.items = read.items
            read.obj.summary = recomputeSummary(read.items)
            return { added, skipped, size: read.items.length }
          })
          return sendJson(res, 200, { ok: true, added: result.added, skipped: result.skipped, size: result.size })
        } catch (error) {
          return sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : '写入失败' })
        }
      },
    })

    // 导出：下载当前持久库完整 JSON。
    const exportRoute = webServer.register({
      kind: 'exact',
      path: `${apiBase}/export`,
      handler: async (req, res) => {
        if (!sameOrigin(req) || !tokenOk(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        const read = await loadPersistent()
        const stamp = new Date().toISOString().slice(0, 10)
        const payload = JSON.stringify(read.obj, null, 2)
        return sendText(res, 200, payload, `exam-bank-${stamp}.json`)
      },
    })

    // PDF 下载：卷子只在内存里活 10 分钟，这里按 id 取，不读盘也不列目录
    const pdfRoute = webServer.register({
      kind: 'exact',
      path: PDF_PATH,
      handler: (req, res) => {
        const id = queryOf(req).get('id') ?? ''
        const hit = /^[a-f0-9]{32}$/.test(id) ? getPdf(id) : undefined
        if (!hit) return sendJson(res, 404, { ok: false, error: '文件已过期，请重新导出' })
        return sendBinary(res, 200, hit.buffer, hit.fileName)
      },
    })

    ctx.logger?.('dsh-exam-gen')?.info?.(`题库管理页：${ADMIN_PATH}`)
    return [pageRoute, toggleRoute, statsRoute, catalogRoute, itemsRoute, addRoute, updateRoute, deleteRoute, importRoute, exportRoute, pdfRoute]
  })

  return ADMIN_PATH
}
