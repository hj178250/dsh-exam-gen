// 知识图谱（mode = 'graph'）：从题库的章节字段聚合出一棵知识树。
//
// 为什么不让模型生成树：题库里 3340 道题自带 425 个章节名，形如
//   「七上 第五章 一元一次方程 5.1.1」
// 这本身就是一张现成的「年级 → 章 → 节 → 知识点」结构表，聚合一次就是 0 token、毫秒级，
// 而且节点后面能直接挂上「这一节有多少道题」——这是模型编不出来的真实覆盖度。
//
// 模型只在「要公式/考频」时才需要出场（后续版本），骨架永远来自题库。
import type { BankIndex, BankItem } from '../bank.js'
import { QuizError } from '../errors.js'
import { scopeCatalog } from '../exam-spec.js'

export interface TreeNode {
  name: string
  /** 1=年级 2=章 3=节/知识点 */
  level: number
  /** 这一节点及其子节点下的题目总数（目录兜底时为 0，表示「题库还没覆盖」）。 */
  count: number
  children: TreeNode[]
}

export interface GraphParams {
  subject: string
  grade?: string
}

export interface GraphResult {
  title: string
  nodes: TreeNode[]
  totalQuestions: number
  /** true = 题库还没这几章的题，树来自插件内置人教版目录（骨架有了，题目待补）。 */
  fromCatalog?: boolean
}

/**
 * 章节名拆解：以「七上 第五章 一元一次方程 5.1.1」为例
 *   七上        → 年级层
 *   第五章 一元一次方程 → 章层
 *   5.1.1       → 节/知识点层（没有时只有两级）
 * 少数数据集的章节名是纯章节名（没有年级前缀），此时整体作为章层。
 */
const GRADE_PREFIX = /^(小学|初中|高中|[一二三四五六七八九]?[上下]|[一二三四五六七八九]年级.*)$/

function parseChapter(chapter: string): { grade: string; chapterName: string; point?: string } {
  const parts = chapter.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { grade: '未分级', chapterName: chapter }

  let index = 0
  let grade = ''
  if (GRADE_PREFIX.test(parts[0])) {
    grade = parts[0]
    index = 1
  }

  // 结尾若是形如 5.1.1 / 3.2 / 12 的编号，视为知识点层
  let point: string | undefined
  const last = parts[parts.length - 1]
  if (parts.length - index > 1 && /^[0-9]+(\.[0-9]+)*$/.test(last)) {
    point = last
    parts.pop()
  }

  const chapterName = parts.slice(index).join(' ') || chapter
  return { grade: grade || '未分级', chapterName, point }
}

export function buildKnowledgeTree(index: BankIndex, params: GraphParams): GraphResult {
  const subject = (params.subject ?? '').trim()
  if (!subject) throw new QuizError('BAD_PARAMS', '请先说明科目（例如 数学）')
  const wantedGrade = (params.grade ?? '').trim()

  const items: BankItem[] = (index.bySubject.get(subject) ?? []).filter((item) => {
    if (!wantedGrade) return true
    return (item.grade ?? '').startsWith(wantedGrade) || (item.chapter ?? '').startsWith(wantedGrade)
  })
  // 题库没这几章的题时不再直接报错：甲方要的「每个年级知识点提前分类写死」就在这里兜底——
  // 用插件内置的人教版目录先出一棵完整骨架，题量标 0，用户能看到「这学期要学哪些章」。
  if (items.length === 0) return catalogTree(subject, wantedGrade)

  const gradeMap = new Map<string, Map<string, Map<string, number>>>()
  for (const item of items) {
    const chapter = (item.chapter ?? '').trim()
    if (!chapter) continue
    const { grade, chapterName, point } = parseChapter(chapter)
    if (!gradeMap.has(grade)) gradeMap.set(grade, new Map())
    const chapterMap = gradeMap.get(grade) as Map<string, Map<string, number>>
    if (!chapterMap.has(chapterName)) chapterMap.set(chapterName, new Map())
    const pointMap = chapterMap.get(chapterName) as Map<string, number>
    const key = point ?? ''
    pointMap.set(key, (pointMap.get(key) ?? 0) + 1)
  }

  const nodes: TreeNode[] = []
  for (const grade of [...gradeMap.keys()].sort(compareGrade)) {
    const chapterMap = gradeMap.get(grade) as Map<string, Map<string, number>>
    const chapterNodes: TreeNode[] = []
    for (const chapterName of [...chapterMap.keys()].sort(compareChapter)) {
      const pointMap = chapterMap.get(chapterName) as Map<string, number>
      const points = [...pointMap.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh'))
      const chapterCount = [...pointMap.values()].reduce((sum, n) => sum + n, 0)
      chapterNodes.push({
        name: chapterName,
        level: 2,
        count: chapterCount,
        children: points.map((point) => ({
          name: point,
          level: 3,
          count: pointMap.get(point) ?? 0,
          children: [],
        })),
      })
    }
    nodes.push({
      name: grade,
      level: 1,
      count: chapterNodes.reduce((sum, node) => sum + node.count, 0),
      children: chapterNodes,
    })
  }

  return {
    title: `${wantedGrade ? `${wantedGrade}年级` : ''}${subject} · 知识结构（按题库覆盖度）`,
    nodes,
    totalQuestions: items.length,
  }
}

/**
 * 题库兜底：用 SCOPE_MAP 里写死的人教版目录造一棵树。
 * 章节点是章节名，节节点暂空（目录里没有节级信息），题量统一 0 —— 明确表示「还没题」。
 */
function catalogTree(subject: string, wantedGrade: string): GraphResult {
  const catalog = scopeCatalog()
  const books = wantedGrade
    ? catalog.filter((entry) => entry.book.startsWith(wantedGrade) || entry.book.includes(wantedGrade.replace(/^高|^初/, '')))
    : catalog
  const picked = books.length > 0 ? books : catalog
  const nodes: TreeNode[] = picked.map((entry) => ({
    name: entry.book,
    level: 1,
    count: 0,
    children: entry.chapters.map((chapter) => ({ name: chapter, level: 2, count: 0, children: [] })),
  }))
  return {
    title: `${wantedGrade ? `${wantedGrade}·` : ''}${subject} · 知识结构（教材目录 · 题库待补）`,
    nodes,
    totalQuestions: 0,
    fromCatalog: true,
  }
}

const CN_DIGIT: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
}

/** 把「第三章 / 第十二章」的中文序号换成数字，章节列表才按课本顺序排。 */
function chapterNumber(name: string): number {
  const match = /^第([一二三四五六七八九十百]+)章/.exec(name)
  if (!match) return Number.MAX_SAFE_INTEGER
  const text = match[1]
  if (text === '十') return 10
  if (text.length === 1) return CN_DIGIT[text] ?? Number.MAX_SAFE_INTEGER
  // 十一 ~ 九十九
  const [tens, ones] = text.split('十')
  const tensValue = tens ? (CN_DIGIT[tens] ?? 1) : 1
  const onesValue = ones ? (CN_DIGIT[ones] ?? 0) : 0
  return tensValue * 10 + onesValue
}

function compareChapter(a: string, b: string): number {
  const na = chapterNumber(a)
  const nb = chapterNumber(b)
  if (na !== nb) return na - nb
  return a.localeCompare(b, 'zh')
}

const GRADE_ORDER = ['小学', '七上', '七下', '八上', '八下', '九上', '九下', '高一', '高二', '高三']

function compareGrade(a: string, b: string): number {
  const ia = GRADE_ORDER.findIndex((g) => a.startsWith(g) || g.startsWith(a))
  const ib = GRADE_ORDER.findIndex((g) => b.startsWith(g) || g.startsWith(b))
  if (ia >= 0 && ib >= 0) return ia - ib
  return a.localeCompare(b, 'zh')
}

/** 渲染成纯文本层级列表（对话里直接用，和 PDF 同一份内容）。 */
export function renderGraphText(result: GraphResult): string {
  const coverage = result.fromCatalog
    ? `教材目录骨架（题库还没这几章的题，先按人教版目录列出要学什么）`
    : `共 ${result.totalQuestions} 道题，覆盖 ${result.nodes.length} 个年级段`
  const lines: string[] = [`## ${result.title}`, '', `${coverage}。`, '']
  result.nodes.forEach((grade, gi) => {
    const suffix = grade.count > 0 ? `（${grade.count} 题）` : ''
    lines.push(`**${gi + 1}. ${grade.name}**${suffix}`)
    grade.children.forEach((chapter, ci) => {
      const chapterSuffix = chapter.count > 0 ? `（${chapter.count} 题）` : ''
      lines.push(`　${gi + 1}.${ci + 1} ${chapter.name}${chapterSuffix}`)
      chapter.children.forEach((point, pi) => {
        lines.push(`　　${gi + 1}.${ci + 1}.${pi + 1} 第 ${point.name} 节（${point.count} 题）`)
      })
    })
    lines.push('')
  })
  return lines.join('\n')
}
