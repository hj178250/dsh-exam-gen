// 本地检索层：从题库里按 年级/科目/范围/难度 找几条同风格参考题，给模型「对齐风格」。
// 只取极少量（默认 2 条）并截断正文，避免把检索结果变成 token 大头。
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
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

/** DSH 用户数据目录：插件自增长/用户改的题库放这里，DSH 更新不会抹掉。 */
export function dshHome(): string {
  return process.env.DSH_HOME && process.env.DSH_HOME.trim() ? process.env.DSH_HOME : join(homedir(), '.dsh')
}

/** 随包分发的原始题库目录（只读，DSH 更新会被覆盖）。 */
export function seedDir(): string {
  return process.env.DSH_EXAM_SEED_DIR ?? join(packageRoot(), 'data')
}

/**
 * 持久题库目录：用户数据区 <DSH_HOME>/exam-gen-bank。
 * 模型回写、用户自改的题都进这里，跟随包原始库分离——DSH 更新只动包目录，动不了这份。
 * 自测时（DSH_EXAM_SEED_DIR）直接回退到 seedDir，避免污染用户数据。
 */
export function persistentDir(): string {
  if (process.env.DSH_EXAM_SEED_DIR) return process.env.DSH_EXAM_SEED_DIR
  return join(dshHome(), 'exam-gen-bank')
}

/**
 * 当前生效的题库目录：
 * 1) 自测环境变量优先；
 * 2) 持久库存在（说明已经回写/改过）→ 用持久库；
 * 3) 否则用随包原始库。
 */
function activeDir(): string {
  if (process.env.DSH_EXAM_SEED_DIR) return process.env.DSH_EXAM_SEED_DIR
  const persistent = join(dshHome(), 'exam-gen-bank', 'bank.json')
  return existsSync(persistent) ? join(dshHome(), 'exam-gen-bank') : join(packageRoot(), 'data')
}

/** 当前题库索引（懒加载，进程内缓存）。 */
export async function getBank(): Promise<BankIndex> {
  return loadBank(activeDir())
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
