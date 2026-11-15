// 本地检索层：从题库里按 年级/科目/范围/难度 找几条同风格参考题，给模型「对齐风格」。
// 只取极少量（默认 2 条）并截断正文，避免把检索结果变成 token 大头。
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadBank, searchBank, type BankIndex, type BankItem } from './bank.js'

export interface ReferenceQuestion {
  grade?: string
  subject?: string
  chapter?: string
  type?: string
  content: string
  options?: string[]
  answer?: string
  analysis?: string
}

export interface RetrieveQuery {
  grade: string
  subject: string
  scope: string
  difficulty?: string
  limit?: number
  /** 单条正文截断长度（字符）。 */
  clip?: number
}

export interface RetrieveHit {
  content: string
  answer?: string
  chapter?: string
  score: number
}

const HERE = dirname(fileURLToPath(import.meta.url))

/** 包根目录（dist/ 的上一级）。题库放在 <包根>/data。 */
export function packageRoot(): string {
  return resolve(HERE, '..')
}

/** 题库目录：DSH_EXAM_SEED_DIR 优先（自测/换库用），否则 <包根>/data。 */
export function seedDir(): string {
  return process.env.DSH_EXAM_SEED_DIR ?? join(packageRoot(), 'data')
}

/** 当前题库索引（懒加载，进程内缓存）。 */
export async function getBank(): Promise<BankIndex> {
  return loadBank(seedDir())
}

/**
 * 检索参考题。命中规则见 bank.searchBank：学科一致 + 年级加分 + 章节/知识点命中 + 难度接近，
 * 依赖配图的题降权，分数 ≤0 的丢弃。返回已裁剪的命中（控制 token）。
 */
export async function retrieveReferences(query: RetrieveQuery): Promise<RetrieveHit[]> {
  const limit = query.limit ?? 2
  const clip = query.clip ?? 60
  const index = await getBank()
  if (index.size === 0) return []
  const hits: BankItem[] = searchBank(index, {
    grade: query.grade,
    subject: query.subject,
    scope: query.scope,
    difficulty: query.difficulty,
    limit,
  })
  return hits.map((item, order) => ({
    content: clamp(item.content, clip),
    answer: item.answer === undefined ? undefined : clamp(String(item.answerText ?? item.answer), 24),
    chapter: item.chapter,
    score: limit - order,
  }))
}

function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}
