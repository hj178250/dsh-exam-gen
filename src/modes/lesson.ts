// 个性化教学讲义（mode = 'lesson'）：把题库里一个知识点的题整理成一份能上课的讲义。
//
// 讲义和卷子的区别是「有讲解」——但讲解不一定非要模型现编：
// 题库里每道题都带解析（explanation），同一知识点的题凑在一起，本身就是这份讲义的素材。
// 所以这一版先做「本地讲义」：
//   · 知识点区：这个主题下题库覆盖了哪些章节、常见问法是什么（按题型统计）；
//   · 例题精讲：挑解析最完整的一道，题干 + 答案 + 完整解析原样呈现；
//   · 变式练习：再挑几道同主题的题留给学生做；
//   · 小结：这一步要练什么、别踩什么坑。
// 全程 0 token。要「更详细的讲解文字」时再让模型补，那属于可选的加强项。
import type { BankIndex, BankItem } from '../bank.js'
import { searchBank } from '../bank.js'
import { QuizError } from '../errors.js'
import type { QuestionType } from './paper.js'

export interface LessonParams {
  grade: string
  subject: string
  /** 讲义主题（一个知识点）。 */
  topic: string
  count: number
  difficulty: '基础' | '中等' | '拔高'
  withAnswer: boolean
}

export interface LessonSection {
  type: 'concept' | 'example' | 'exercise' | 'summary'
  title: string
  /** 段落式内容，每项一段（PDF 里逐段排）。 */
  lines: string[]
}

export interface LessonExample {
  stem: string
  answer: string
  explanation: string
  options?: string[]
}

export interface LessonResult {
  title: string
  topic: string
  sections: LessonSection[]
  example?: LessonExample
  exercises: LessonExample[]
  meta: { chapters: string[]; totalQuestions: number }
}

const TYPE_LABEL: Record<string, string> = {
  choice: '选择题',
  fill: '填空题',
  solve: '解答题',
  short: '解答题',
  solution: '解答题',
  self: '解答题',
  numeric: '填空题',
}

function toExample(item: BankItem): LessonExample {
  return {
    stem: (item.content ?? '').trim(),
    answer: String(item.answerText ?? item.answer ?? '').trim(),
    explanation: (item.explanation ?? '').trim(),
    options: item.type === 'choice' ? (item.options ?? []) : undefined,
  }
}

export function buildLesson(index: BankIndex, params: LessonParams): LessonResult {
  const subject = (params.subject ?? '').trim()
  if (!subject) throw new QuizError('BAD_PARAMS', '请先说明科目（例如 数学）')
  const topic = (params.topic ?? '').trim()
  if (!topic) throw new QuizError('BAD_PARAMS', '请先说明讲义主题（要讲哪个知识点）')

  // 讲义不限定题型：同一个知识点下选择/填空/解答混着看，才看得出这个点怎么考
  const pool = searchBank(index, {
    grade: params.grade,
    subject,
    scope: topic,
    difficulty: params.difficulty,
    limit: 300,
  })
  if (pool.length === 0) {
    throw new QuizError('BANK_MISS', `题库里还没有「${topic}」的题，换个主题或先往题库加题`, 'lesson')
  }

  const unique: BankItem[] = []
  const seen = new Set<string>()
  for (const item of pool) {
    const stem = (item.content ?? '').trim()
    if (!stem || seen.has(stem)) continue
    seen.add(stem)
    unique.push(item)
  }

  // 检索是按关键词打分，像「解法」这种字半个题库都沾边，
  // 所以讲义只认「命中最多的那几个章节」——否则讲义会变成整库大杂烩。
  const chapterOf = (item: BankItem) => (item.chapter ?? '').split(/\s+/).filter(Boolean).slice(0, 3).join(' ')
  const chapterCount = new Map<string, number>()
  for (const item of unique) {
    const chapter = chapterOf(item)
    if (!chapter) continue
    chapterCount.set(chapter, (chapterCount.get(chapter) ?? 0) + 1)
  }
  const focusedChapters = [...chapterCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([chapter]) => chapter)
  const focused = focusedChapters.length > 0 ? unique.filter((item) => focusedChapters.includes(chapterOf(item))) : unique

  // 例题优先挑「解析最完整」的那道：讲义里最怕例题没讲透。
  // 但只在主章节（命中最多的那一章）里挑 —— 否则「一元一次方程的解法」会挑出一道一元二次的题，
  // 学生一看例题就觉得这份讲义不是给自己的。
  const primaryChapter = focusedChapters[0]
  const primaryPool = primaryChapter ? focused.filter((item) => chapterOf(item) === primaryChapter) : focused
  const pickFrom = primaryPool.length > 0 ? primaryPool : focused
  const exampleItem = pickFrom
    .slice()
    .sort((a, b) => (b.explanation ?? '').length - (a.explanation ?? '').length)[0]
  const rest = focused.filter((item) => item !== exampleItem)
  const exerciseItems = rest.slice(0, Math.max(1, Math.min(params.count, 6)))

  const chapters = focusedChapters.length > 0 ? focusedChapters : [
    ...new Set(unique.map(chapterOf).filter(Boolean)),
  ]

  const typeCount = new Map<string, number>()
  for (const item of focused) {
    const label = TYPE_LABEL[item.type ?? 'fill'] ?? '其它'
    typeCount.set(label, (typeCount.get(label) ?? 0) + 1)
  }
  const typeLine = [...typeCount.entries()].map(([label, n]) => `${label} ${n} 道`).join('、')

  const conceptLines = [
    `本讲义覆盖：${chapters.join('、') || topic}。`,
    `题库里这个点在 ${chapters.length} 个章节出现 ${focused.length} 次，题型分布：${typeLine}。`,
    `上课顺序建议：先看下面的例题（把「这类题长什么样」立住），再让学生自己做变式练习，最后回看小结。`,
  ]

  const example = exampleItem ? toExample(exampleItem) : undefined
  const exercises = exerciseItems.map(toExample)

  const summaryLines = [
    `这一步要练的是：看到题先判断它属于「${topic}」里的哪一类问法，再选方法，别一上来就算。`,
    example?.explanation
      ? '例题的解析就是标准写法，让学生照着复述一遍步骤，比再做十道题有用。'
      : '练习时先让学生写思路，再动笔算，减少「会算但不知为什么这么算」。',
    difficultyTip(params.difficulty),
  ]

  const sections: LessonSection[] = [
    { type: 'concept', title: '知识点', lines: conceptLines },
    { type: 'example', title: '例题精讲', lines: example ? [example.stem] : [] },
    { type: 'exercise', title: '变式练习', lines: exercises.map((item, i) => `${i + 1}. ${item.stem}`) },
    { type: 'summary', title: '小结', lines: summaryLines },
  ]

  return {
    title: `${params.grade}${subject} · ${topic}（讲义）`,
    topic,
    sections,
    example,
    exercises,
    meta: { chapters, totalQuestions: unique.length },
  }
}

function difficultyTip(difficulty: string): string {
  if (difficulty === '基础') return '这一版是打底用：允许慢，但每一步都要写出来，不许跳步。'
  if (difficulty === '拔高') return '这一版偏压轴：重点不是算得快，是从多问里认出「第一问的结论能不能直接给第二问用」。'
  return '这一版是常规难度：目标是做题速度和准确率都稳定，错题必须回到对应小节重看。'
}

/** 对话里直接展示的文本版（和 PDF 同一份内容）。 */
export function renderLessonText(result: LessonResult): string {
  const lines: string[] = [`## ${result.title}`, '']
  result.sections.forEach((section) => {
    lines.push(`### ${section.title}`)
    if (section.type === 'example' && result.example) {
      lines.push(`**题目**：${result.example.stem}`)
      if (result.example.options?.length) {
        lines.push(result.example.options.map((option, i) => `${String.fromCharCode(65 + i)}. ${option}`).join('　　'))
      }
      lines.push('')
      lines.push(`**答案**：${result.example.answer}`)
      if (result.example.explanation) lines.push(`**解析**：${result.example.explanation}`)
    } else {
      section.lines.forEach((line) => lines.push(line))
    }
    lines.push('')
  })
  if (result.exercises.length > 0) {
    lines.push('---', '', '### 练习答案')
    result.exercises.forEach((item, index) => {
      lines.push(`**${index + 1}.** ${item.answer}${item.explanation ? `（${item.explanation}）` : ''}`)
    })
  }
  return lines.join('\n')
}

export type { QuestionType }
