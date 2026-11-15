/**
 * 生成好的 PDF 在内存里短暂存一下，给浏览器下载用。
 *
 * 为什么不落盘到固定目录：卷子是「点一下导出」的一次性产物，用户下完就没用了，
 * 写进 data/ 目录会把插件缓存越攒越大、还得额外做清理。这里只留 10 分钟，
 * 超过就随进程内存一起丢，卸载插件也没有残留。
 */
import { randomBytes } from 'node:crypto'

export interface StoredPdf {
  id: string
  fileName: string
  buffer: Buffer
  createdAt: number
}

const TTL_MS = 10 * 60 * 1000
const MAX_ENTRIES = 24

const store = new Map<string, StoredPdf>()

/** 放进缓存，返回随机 id（32 位十六进制）。 */
export function putPdf(fileName: string, buffer: Buffer): string {
  sweep()
  const id = randomBytes(16).toString('hex')
  store.set(id, { id, fileName, buffer, createdAt: Date.now() })
  // 超量时按时间淘汰最旧的
  while (store.size > MAX_ENTRIES) {
    const oldest = [...store.values()].sort((a, b) => a.createdAt - b.createdAt)[0]
    if (!oldest) break
    store.delete(oldest.id)
  }
  return id
}

/** 取一份，过期的当不存在。 */
export function getPdf(id: string): StoredPdf | undefined {
  const hit = store.get(id)
  if (!hit) return undefined
  if (Date.now() - hit.createdAt > TTL_MS) {
    store.delete(id)
    return undefined
  }
  return hit
}

function sweep(): void {
  const now = Date.now()
  for (const [id, entry] of store) {
    if (now - entry.createdAt > TTL_MS) store.delete(id)
  }
}
