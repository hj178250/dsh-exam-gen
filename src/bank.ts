// 题库加载与检索索引。
//
// 设计要点：
// 1. 启动后只读一次 bank.json（2 MB），内存里建 学科 → 条目 的倒排表，检索不碰磁盘。
// 2. 打分只看三件事：年级匹配、章节/知识点命中、难度接近；同分时「非配图题」优先，
//    因为题目描述依赖配图的题在纯文本生成里没法用。
// 3. 所有对外结构都是纯数据，方便单测（不依赖 ctx）。
import { readFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { stripLatex, stripLatexList } from './latex.js'

export interface BankItem {
  id: string
  stage?: string
  grade?: string
  subject?: string
  chapter?: string
  domain?: string
  topic?: string
  difficulty?: string
  type?: string
  content: string
  options?: string[]
  answer?: string
  answerText?: string
  explanation?: string
  hasFigure?: boolean
  source?: string
}

export interface BankIndex {
  items: BankItem[]
  bySubject: Map<string, BankItem[]>
  chapters: Map<string, number>
  size: number
  license?: string
}

export interface BankQuery {
  grade: string
  subject: string
  scope: string
  difficulty?: string
  limit?: number
}

const DIFF_ORDER = ['基础', '中档', '拔高']

let cached: BankIndex | undefined
let cachedKey = ''

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[\s，。；：、（）()【】\[\]{}"'“”‘’]/g, '')
}

/** 从 scope 与 chapter 里抽关键词：中文按 2 字滑窗，英文数字按整词。 */
export function keywords(text: string): string[] {
  const out = new Set<string>()
  const cleaned = text.replace(/[，。；：、（）()【】\[\]{}"'“”‘’]/g, ' ')
  for (const piece of cleaned.split(/\s+/)) {
    if (!piece) continue
    if (/^[a-z0-9.+-]+$/i.test(piece)) {
      if (piece.length >= 2) out.add(piece.toLowerCase())
      continue
    }
    // 中文：整段 + 2 字滑窗
    if (piece.length <= 6) out.add(piece)
    for (let i = 0; i + 2 <= piece.length; i += 1) out.add(piece.slice(i, i + 2))
  }
  return [...out]
}

async function readBankFile(file: string): Promise<BankItem[]> {
  const raw = JSON.parse(await readFile(file, 'utf8')) as unknown
  if (Array.isArray(raw)) return raw as BankItem[]
  const obj = raw as { items?: BankItem[] }
  return Array.isArray(obj.items) ? obj.items : []
}

/**
 * 加载题库。优先 <dir>/bank.json，回退 <dir>/quiz-seed.json。
 * 结果按 dir+mtime 缓存，换库或改库自动失效。
 * 合并策略（关键）：持久库（用户回写/自改的题）与随包原始库**合并加载**——
 * 旧逻辑持久库存在就完全顶掉原始库，导致用户早期只有 43 道题时，
 * 3000+ 道的原始种子库永远读不到（物理/化学题库直出全空、全部走慢速模型）。
 */
export async function loadBank(dir: string, extraDirs?: string[]): Promise<BankIndex> {
  const files: string[] = []
  for (const d of extraDirs ?? []) {
    const ef = join(d, 'bank.json')
    const el = join(d, 'quiz-seed.json')
    if (existsSync(ef)) files.push(ef)
    else if (existsSync(el)) files.push(el)
  }
  const bankFile = join(dir, 'bank.json')
  const legacyFile = join(dir, 'quiz-seed.json')
  const file = existsSync(bankFile) ? bankFile : existsSync(legacyFile) ? legacyFile : ''
  if (file) files.push(file)
  if (files.length === 0) {
    return { items: [], bySubject: new Map(), chapters: new Map(), size: 0 }
  }
  // 缓存 key 必须含 mtime+size：写回题库后文件变了要自动重载，否则「无感回写」的题永远进不了内存索引。
  let stamp = ''
  for (const f of files) {
    try {
      const st = statSync(f)
      stamp += `${st.mtimeMs}:${st.size};`
    } catch {
      stamp += '0:0;'
    }
  }
  const key = files.join('|') + `|${stamp}`
  if (cached && cachedKey === key) return cached

  const seen = new Set<string>()
  const items: BankItem[] = []
  for (const f of files) {
    let batch: BankItem[] = []
    try {
      batch = await readBankFile(f)
    } catch {
      batch = []
    }
    for (const item of batch) {
      if (!item?.content) continue
      // 去重：同一道题以先加载的库为准（extraDirs 里的原始库先进，持久库后进覆盖不了）
      const id = item.id ?? ''
      const dedup = id ? `${id}` : ''
      if (dedup && seen.has(dedup)) continue
      if (dedup) seen.add(dedup)
      items.push(item)
    }
  }
  // 题库里的 LaTeX 在这里一次性转成纯文本：聊天窗口不会渲成碎行，pdf 那边还能把 1/2 排成上下结构
  for (const item of items) {
    if (!item) continue
    if (item.content) item.content = stripLatex(item.content)
    if (item.options) item.options = stripLatexList(item.options)
    if (item.explanation) item.explanation = stripLatex(item.explanation)
    if (item.answerText) item.answerText = stripLatex(item.answerText)
    if (item.topic) item.topic = stripLatex(item.topic)
  }
  const bySubject = new Map<string, BankItem[]>()
  const chapters = new Map<string, number>()
  for (const item of items) {
    if (!item?.content) continue
    const subject = item.subject ?? ''
    const bucket = bySubject.get(subject)
    if (bucket) bucket.push(item)
    else bySubject.set(subject, [item])
    if (item.chapter) chapters.set(item.chapter, (chapters.get(item.chapter) ?? 0) + 1)
  }
  cached = { items, bySubject, chapters, size: items.length }
  cachedKey = key
  return cached
}

function scoreItem(item: BankItem, query: BankQuery, wanted: string[]): number {
  let score = 0
  if (item.grade && query.grade && item.grade === query.grade) score += 4
  else if (item.grade && query.grade) {
    // 同 stage 兜底：初一~初三 互认 1 分，高一~高三 互认 1 分
    const junior = ['初一', '初二', '初三']
    const senior = ['高一', '高二', '高三']
    if (junior.includes(item.grade) && junior.includes(query.grade)) score += 1
    if (senior.includes(item.grade) && senior.includes(query.grade)) score += 1
  }
  if (item.hasFigure) score -= 2
  if (query.difficulty && item.difficulty) {
    const delta = Math.abs(DIFF_ORDER.indexOf(item.difficulty) - DIFF_ORDER.indexOf(query.difficulty))
    if (delta === 0) score += 2
    else if (delta === 1) score += 1
    else score -= 1
  }
  const haystack = normalizeText(`${item.chapter ?? ''}${item.topic ?? ''}${item.domain ?? ''}`)
  for (const token of wanted) {
    if (token.length < 2) continue
    if (haystack.includes(normalizeText(token))) score += 2
  }
  // 真题来源优先：手工整理的那批带真实卷面问法和完整情境，是最像卷子的样本；
  // 数据集里的诊断题只有在没有真题可选时才顶上。
  if (item.source === 'public-corpus') score += 6
  score += naturalness(item)
  return score
}

/**
 * 「这题印在卷子上像不像话」的粗略打分。
 *
 * 数据集里的题干有两种：一种带情境（"某班买了……共花了……"），一种是对知识点直问
 * （"下列式子中，是方程的是哪一个？"）。后者连出 8 道就是甲方说的「僵硬」。
 * 这里给带情境、有解析的题加分，给纯判断式题干减分，让选题偏向更像真题的那一批。
 */
function naturalness(item: BankItem): number {
  const text = item.content ?? ''
  let score = 0
  if (item.explanation && item.explanation.length >= 8) score += 1
  if (text.length >= 18 && text.length <= 90) score += 1
  if (/^下列|^以下|^下面/.test(text)) score -= 1
  if (/(多少|几|求|已知|若|某|如图|计算|化简)/.test(text)) score += 1
  if (/（\s*）$/.test(text.trim())) score -= 0.5
  return score
}

/**
 * 检索参考题。返回分数降序的前 limit 条；分数 ≤0 的丢掉（避免给模型无关样例）。
 * 学科必须一致，除非题库里没有该学科（此时放宽）。
 */
export function searchBank(index: BankIndex, query: BankQuery): BankItem[] {
  const limit = Math.max(0, Math.min(query.limit ?? 2, 200))
  if (limit === 0) return []
  const pool = index.bySubject.get(query.subject) ?? []
  const source = pool.length ? pool : index.items
  const wanted = keywords(`${query.scope}`)
  const scored: Array<{ item: BankItem; score: number }> = []
  for (const item of source) {
    if (item.stage === 'primary') continue
    const score = scoreItem(item, query, wanted)
    if (score > 0) scored.push({ item, score })
  }
  scored.sort((left, right) => right.score - left.score || String(left.item.id ?? '').localeCompare(String(right.item.id ?? '')))
  return scored.slice(0, limit).map((row) => row.item)
}

/** 题库概况，给工具描述/自检用。 */
export function bankStats(index: BankIndex): { size: number; chapters: number; subjects: Record<string, number> } {
  const subjects: Record<string, number> = {}
  for (const [subject, list] of index.bySubject) subjects[subject || '(未标注)'] = list.length
  return { size: index.size, chapters: index.chapters.size, subjects }
}