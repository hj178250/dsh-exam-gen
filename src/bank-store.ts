// 题库存储层：可读可写。
//
// 设计取舍：
// 1. 写盘只做「整文件重写 + 原子替换」，不做增量 patch —— 题库 2 MB，重写一次几十毫秒，
//    换来的是永远不会写出半截 JSON。多会话并发由插件进程内的串行写队列兜住（p-queue 单并发）。
// 2. 校验放在写入前：任何一道题不合格就整体拒绝，不写坏库。
// 3. 生成/手工新增的题统一标 source，方便以后按来源淘汰。
import { readFile, rename, writeFile, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { BankItem } from './bank.js'

export interface BankFile {
  version: number
  kind: string
  license?: string
  attribution?: string[]
  summary?: Record<string, unknown>
  items: BankItem[]
}

/** 题库上限：超过就按「最久未用 + 最低质量」淘汰（只有 generated 参与淘汰）。 */
export const MAX_GENERATED_BANK_SIZE = 10_000

const DIFFS = ['基础', '中档', '拔高']
const TYPES = ['choice', 'fill', 'solve']

export function bankPath(dir: string): string {
  const bank = join(dir, 'bank.json')
  return existsSync(bank) ? bank : join(dir, 'quiz-seed.json')
}

export async function readBankFile(file: string): Promise<BankFile> {
  const parsed = JSON.parse(await readFile(file, 'utf8')) as BankFile | BankItem[]
  if (Array.isArray(parsed)) {
    return { version: 1, kind: 'exam-gen-bank', items: parsed }
  }
  return { ...parsed, version: parsed.version ?? 1, kind: parsed.kind ?? 'exam-gen-bank', items: parsed.items ?? [] }
}

/** 原子写：先写 .tmp，再 rename 覆盖。同目录 rename 在 NTFS/ext4 上都是原子的。 */
export async function writeBankFileAtomic(file: string, data: BankFile): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  const payload = JSON.stringify(data)
  try {
    await writeFile(tmp, payload, 'utf8')
    await rename(tmp, file)
  } catch (error) {
    if (existsSync(tmp)) {
      try {
        await unlink(tmp)
      } catch {
        // 清理失败不影响主流程
      }
    }
    throw error
  }
}

/** 串行写队列：同一时刻只允许一个写操作，避免两个会话互相覆盖。 */
let writeChain: Promise<unknown> = Promise.resolve()

export function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const next = writeChain.then(task, task)
  writeChain = next.catch(() => undefined)
  return next
}

export interface ItemDraft {
  grade?: string
  subject?: string
  chapter?: string
  topic?: string
  difficulty?: string
  type?: string
  content: string
  options?: string[]
  answer?: string
  answerText?: string
  explanation?: string
  stage?: string
  source?: string
}

export interface ValidationResult {
  ok: boolean
  errors: string[]
  item?: BankItem
}

const JUNIOR = ['初一', '初二', '初三']
const SENIOR = ['高一', '高二', '高三']

function stageOf(grade?: string): string | undefined {
  if (!grade) return undefined
  if (JUNIOR.includes(grade)) return 'junior'
  if (SENIOR.includes(grade)) return 'senior'
  return undefined
}

function newId(): string {
  return `custom-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
}

/** 校验并规整一道待写入的题。 */
export function validateDraft(draft: ItemDraft): ValidationResult {
  const errors: string[] = []
  const content = (draft.content ?? '').trim()
  if (content.length < 4) errors.push('题干太短（至少 4 个字）')
  if (content.length > 2000) errors.push('题干过长（超过 2000 字）')

  const type = draft.type ?? 'choice'
  if (!TYPES.includes(type)) errors.push(`题型必须是 ${TYPES.join('/')}`)

  const options = (draft.options ?? []).map((option) => String(option).trim()).filter((option) => option !== '')
  if (type === 'choice') {
    if (options.length < 2) errors.push('选择题至少要有 2 个选项')
    if (options.length > 6) errors.push('选项最多 6 个')
  }

  const answer = String(draft.answer ?? '').trim()
  if (!answer) errors.push('答案不能为空')
  if (type === 'choice' && answer) {
    if (!/^[A-F]$/i.test(answer)) errors.push('选择题答案必须是 A~F 的单个字母')
    else if (options.length && answer.toUpperCase().charCodeAt(0) - 65 >= options.length) {
      errors.push(`答案字母 ${answer} 超出选项数量（共 ${options.length} 项）`)
    }
  }

  const difficulty = draft.difficulty ?? '中档'
  if (!DIFFS.includes(difficulty)) errors.push(`难度必须是 ${DIFFS.join('/')}`)

  if (errors.length) return { ok: false, errors }

  const grade = draft.grade?.trim() || undefined
  const subject = draft.subject?.trim() || undefined
  const item: BankItem = {
    id: newId(),
    stage: draft.stage ?? stageOf(grade),
    grade,
    subject,
    chapter: draft.chapter?.trim() || undefined,
    topic: draft.topic?.trim() || undefined,
    difficulty,
    type,
    content,
    options: type === 'choice' ? options : [],
    answer: answer.toUpperCase() === answer && /^[A-F]$/i.test(answer) ? answer.toUpperCase() : answer,
    answerText:
      draft.answerText?.trim() ||
      (type === 'choice' && /^[A-F]$/i.test(answer) ? options[answer.toUpperCase().charCodeAt(0) - 65] : answer),
    explanation: draft.explanation?.trim() || undefined,
    hasFigure: false,
    source: draft.source ?? 'custom',
  }
  return { ok: true, errors: [], item }
}

export interface AppendResult {
  ok: boolean
  errors: string[]
  id?: string
  size?: number
  evicted?: number
}

/** 追加一道题到题库（串行 + 原子写）。 */
export async function appendItem(dir: string, draft: ItemDraft): Promise<AppendResult> {
  const checked = validateDraft(draft)
  if (!checked.ok || !checked.item) return { ok: false, errors: checked.errors }

  return enqueueWrite(async () => {
    const file = bankPath(dir)
    const bank = await readBankFile(file)
    bank.items.push(checked.item as BankItem)
    const evicted = evictGenerated(bank.items)
    bank.items = evicted.items
    bank.summary = recomputeSummary(bank.items)
    await writeBankFileAtomic(file, bank)
    return { ok: true, errors: [], id: (checked.item as BankItem).id, size: bank.items.length, evicted: evicted.count }
  })
}

/** 批量导入：任一条不合格则整体失败，返回逐条错误。 */
export async function importItems(dir: string, drafts: ItemDraft[]): Promise<AppendResult> {
  if (!Array.isArray(drafts) || drafts.length === 0) return { ok: false, errors: ['导入内容为空'] }
  if (drafts.length > 500) return { ok: false, errors: ['单次最多导入 500 道'] }

  const checked = drafts.map((draft, index) => ({ index, result: validateDraft(draft) }))
  const failed = checked.filter((row) => !row.result.ok)
  if (failed.length) {
    return {
      ok: false,
      errors: failed.slice(0, 8).map((row) => `第 ${row.index + 1} 条：${row.result.errors.join('；')}`),
    }
  }

  return enqueueWrite(async () => {
    const file = bankPath(dir)
    const bank = await readBankFile(file)
    for (const row of checked) if (row.result.item) bank.items.push(row.result.item)
    const evicted = evictGenerated(bank.items)
    bank.items = evicted.items
    bank.summary = recomputeSummary(bank.items)
    await writeBankFileAtomic(file, bank)
    return { ok: true, errors: [], size: bank.items.length, evicted: evicted.count }
  })
}

/** 删除一道题（只允许删 source=custom 的，内置题不可删）。 */
export async function removeItem(dir: string, id: string): Promise<AppendResult> {
  return enqueueWrite(async () => {
    const file = bankPath(dir)
    const bank = await readBankFile(file)
    const index = bank.items.findIndex((item) => item.id === id)
    if (index < 0) return { ok: false, errors: ['没有这道题'] }
    if (bank.items[index].source !== 'custom') return { ok: false, errors: ['内置题不可删除，只能覆盖新增一条'] }
    bank.items.splice(index, 1)
    bank.summary = recomputeSummary(bank.items)
    await writeBankFileAtomic(file, bank)
    return { ok: true, errors: [], size: bank.items.length }
  })
}

/**
 * 生成题上限淘汰：只有 source=generated 参与，按 usage 最久未用 + quality 最低排序。
 * 手工题（custom）与内置题不受影响。
 */
export function evictGenerated(items: BankItem[]): { items: BankItem[]; count: number } {
  const generated = items.filter((item) => item.source === 'generated')
  if (generated.length <= MAX_GENERATED_BANK_SIZE) return { items, count: 0 }
  const ranked = [...generated].sort((left, right) => {
    const useLeft = Number((left as BankItem & { lastUsed?: number }).lastUsed ?? 0)
    const useRight = Number((right as BankItem & { lastUsed?: number }).lastUsed ?? 0)
    if (useLeft !== useRight) return useLeft - useRight
    return Number((left as BankItem & { quality?: number }).quality ?? 0) - Number((right as BankItem & { quality?: number }).quality ?? 0)
  })
  const drop = new Set(ranked.slice(0, generated.length - MAX_GENERATED_BANK_SIZE).map((item) => item.id))
  return { items: items.filter((item) => !drop.has(item.id)), count: drop.size }
}

export function recomputeSummary(items: BankItem[]): Record<string, unknown> {
  const subjects: Record<string, number> = {}
  const types: Record<string, number> = {}
  const difficulties: Record<string, number> = {}
  const chapters = new Set<string>()
  let junior = 0
  let senior = 0
  for (const item of items) {
    subjects[item.subject ?? '(未标注)'] = (subjects[item.subject ?? '(未标注)'] ?? 0) + 1
    types[item.type ?? '?'] = (types[item.type ?? '?'] ?? 0) + 1
    difficulties[item.difficulty ?? '?'] = (difficulties[item.difficulty ?? '?'] ?? 0) + 1
    if (item.chapter) chapters.add(item.chapter)
    if (item.stage === 'junior') junior += 1
    else if (item.stage === 'senior') senior += 1
  }
  return { total: items.length, subjects, types, difficulties, chapters: chapters.size, junior, senior }
}

/** 导出为可再导入的 JSON 文本。 */
export function toExportJson(items: BankItem[]): string {
  return JSON.stringify({ version: 1, kind: 'exam-gen-bank-export', items }, null, 2)
}

export { dirname }
