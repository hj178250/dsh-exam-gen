// dsh-exam-gen — K12 理科出题插件
//
// 设计约束（写死在这里，避免后续走偏）：
//   · 一个 generate_content 工具、按 mode 分支，不注册五个工具 —— 工具定义是每请求常驻成本。
//   · 模型调用只走 ctx.llm（用户自己 DSH 里配的模型），插件永不持有任何 Key。
//   · 模型只输出结构化 JSON；排版、渲染、导出全部本地做，零模型调用。
//   · 参数全部有默认值，无空白项，用户不调任何东西直接确定也能跑。
import type { Context } from '@deepseek-ai/cordis'
import { appendFileSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'
import { defineTool } from './tool-kit.js'
import { ensureCardPatch } from './patch-runtime.js'

// 之前 tools / llm 由 @deepseek-ai/dsh-tools 的声明合并提供；为了不把内部包拖进依赖
// （版本一错整个 DSH 起不来），这里自己补上最小声明。
declare module '@deepseek-ai/cordis' {
  interface Context {
    tools: {
      register(tool: unknown): unknown
      get(name: string): unknown
    }
    llm: unknown
  }
}

import { registerAdminPage, currentOrigin } from './admin-server.js'
import { readConfig, writeConfig } from './config.js'
import { PDF_PATH } from './admin-page.js'
import { appendItem } from './bank-store.js'
import type { CardMode } from './cards.js'
import { buildParamCard, cardCall, modeLabel } from './cards.js'
import { parseBrief } from './parse-brief.js'
import { QuizError } from './errors.js'
import type { DefaultModelLike, LlmLike } from './llm.js'
import { callModelText, resolveRoute } from './llm.js'
import { renderPaperPdf, renderSyncPdf, renderGraphPdf } from './pdf.js'
import { putPdf } from './pdf-store.js'
import { generateContent, generateLesson } from './pipeline.js'
import { lessonFromModel } from './modes/lesson-model.js'
import { buildKnowledgeTree, renderGraphText } from './modes/graph.js'
import { buildDrill, renderDrillText } from './modes/drill.js'
import { buildLesson, renderLessonText } from './modes/lesson.js'
import { renderDrillPdf, renderLessonPdf } from './pdf.js'
import { getBank } from './retrieve.js'
import type { PaperQuestion } from './modes/paper.js'
import { seedDir } from './retrieve.js'
import {
  listSubjects, listGrades, listBooks, listChapters, listPoints, findKnowledge, catalogStats,
  listEditions, listBooksForEdition, listChaptersForEdition, listPointsForEdition, findKnowledgeForEdition,
} from './knowledge-catalog.js'

// 教材版本分派：人教版走原接口，其它版本走版本化接口。空值/「人教」统一归到人教版。
function normalizeEdition(edition: string): string {
  const e = (edition || '').trim()
  if (!e || e === '人教' || e === '人教版') return '人教版'
  return e
}
function booksOf(subj: string, g: string, edition: string): string[] {
  return edition === '人教版' ? listBooks(subj, g) : listBooksForEdition(subj, g, edition)
}
function chaptersOf(subj: string, g: string, b: string, edition: string): string[] {
  return edition === '人教版' ? listChapters(subj, g, b) : listChaptersForEdition(subj, g, b, edition)
}
function pointsOf(subj: string, g: string, b: string, c: string, edition: string) {
  return edition === '人教版' ? listPoints(subj, g, b, c) : listPointsForEdition(subj, g, b, c, edition)
}
function knowledgeOf(subj: string, g: string, kw: string, edition: string) {
  return edition === '人教版' ? findKnowledge(subj, g, kw) : findKnowledgeForEdition(subj, g, kw, edition)
}

export const name = 'dsh-exam-gen'

// 服务依赖决定加载顺序：tools 注册表 + llm 运行时都必须先就绪。
export const inject = ['tools', 'llm']

const MODES = ['paper', 'drill', 'lesson', 'graph', 'sync']

// dsh-tools 的 output schema 用 JsonValue；结构化结果在类型上按 any 交出去最省事。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

/** 插件总开关的运行时状态：管理页一拨就改这个，立刻生效，不用重启 */
let runtimeEnabled = readConfig().enabled

/** 启动留痕：插件到底有没有被加载，说不清的时候看这个文件 */
function logBoot(message: string): void {
  try {
    appendFileSync(new URL('../exam-gen-load.log', import.meta.url), `${new Date().toISOString()} ${message}\n`)
  } catch {
    /* 没写权限就算了，不能因为留痕把插件搞崩 */
  }
}

export function apply(ctx: Context) {
  logBoot('apply() entered')
  const llm = (ctx as unknown as { llm: LlmLike }).llm
  const defaults = (ctx as unknown as { get(id: string): unknown }).get('agentDefaultModel') as
    | DefaultModelLike
    | undefined

  ctx.tools.register(defineTool({
    name: 'generate_content',
    description:
      'K12 理科出题，一步到位：试卷 / 专项突破 / 教学讲义 / 知识图谱 / 教材同步，并本地渲染可打印 PDF。' +
      '把用户原话整句放进 brief 即可，参数由插件解析（年级、科目、范围、题数、题型、难度都能认）。' +
      '**用户说得笼统（没点明年级或科目）时不要猜、不要自己编参数**：这个工具会立刻返回一张参数卡，' +
      '你只要把返回的 card 原样传给 chat_ui，让用户在卡片上点选，点完他会带着参数再来一次。' +
      '用户已经把年级和科目说清楚时，直接出，不要再弹卡片。' +
      '模型走用户自己 DSH 里配置的路由，不需要 Key。',

    parameters: {
      type: 'object',
      properties: {
        brief: {
          type: 'string',
          description: '用户原话，例如「初二数学一元一次方程 8 道选择题」「写一份高一数学函数讲义」。',
        },
        quality: {
          type: 'string',
          enum: ['premium', 'turbo'],
          description: 'premium（默认）模型按真题风格现出；turbo 只从题库抽，0 token。',
        },
      },
      required: ['brief'],
      additionalProperties: false,
    },

    output: {
      // 返回字段也瘦身：原来 7 个字段带描述约 200 token，现在只要 ok/text/pdfUrl/note。
      // text 就是成品（卷子正文），模型直接照着说一句就行，不用复述。
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', description: '成功与否。' },
          text: { type: 'string', description: '成品正文。' },
          pdfUrl: { type: 'string', description: 'PDF 文件路径（已生成到本地，直接打开即可），空串表示没导出。' },
          note: { type: 'string', description: '一句话备注（模型、题数、是否命中题库）。' },
          card: {
            type: 'string',
            description: '参数不全时返回的卡片载荷；非空就把这一整段原样传给 chat_ui 的 title/ui 两个参数。',
          },
        },
        required: ['ok', 'text', 'pdfUrl', 'note'],
        additionalProperties: false,
      },
      render: (_args, value) => {
        const data = value as {
          ok?: boolean
          text?: string
          pdfUrl?: string
          note?: string
          card?: string
        }
        // 参数不全：这一轮不生成，直接把卡片交给模型转手，用户点完再来一次
        if (data.card) {
          return [
            {
              type: 'text',
              text:
                '用户说得比较笼统，先让他在卡片上点一下。\n\n' +
                '下一步调用 chat_ui 工具，参数只有两个：title 和 ui。下面这段 JSON 就是它们的值。\n' +
                '注意：ui.tree 里只有一个 Card 节点、故意不写 children 和 actions，这是正常的——插件会在后台自动补全完整布局。' +
                '你绝对不要补 children、不要加 actions、不要修改任何字段，否则卡片会崩。\n' +
                '如果 ui 里有 initialState，那是用户已经说过的参数（年级/科目/范围/题数），**必须一个字不改地带上**，否则用户得从头选一遍。\n\n' +
                'title = JSON 里的 title 字段；ui = JSON 里的 ui 字段。原样传，不要精简、不要省略 initialState。\n\n' +
                data.card,
            },
          ]
        }
        if (data.ok === false) return [{ type: 'text', text: data.text || '出题失败，请重试' }]
        // 有 PDF 就只回一句 + 文件路径，不要把整卷题目再吐回对话里。
        // 吐全文会让模型觉得「内容我自己也有」，于是绕过插件自己写 HTML/Markdown 排版，白烧几千 token。
        if (data.pdfUrl) {
          return [
            {
              type: 'text',
              text:
                `试卷已生成并保存成 PDF：\n\n\`${data.pdfUrl}\`\n\n` +
                (data.note ? `<sub>${data.note}</sub>\n\n` : '') +
                '题目、答案、解析都已经排版在 PDF 里，直接打开打印即可。**不要自己再写 HTML/Markdown 排版，也不要把题目重新列一遍。**',
            },
          ]
        }
        const note = data.note ? `\n\n<sub>${data.note}</sub>` : ''
        return [{ type: 'text', text: (data.text ?? '') + note }]
      },
    },

    async execute(raw): Promise<{
      ok: boolean
      text: string
      pdfUrl: string
      note: string
      card?: string
    }> {
      // 总开关关掉时不接话，让对话回到「没有这个插件」的状态
      if (!runtimeEnabled) {
        return {
          ok: false,
          text: '出题插件现在是关闭状态。想用就打开题库管理页，点右上角「出题：已关闭」那个按钮。',
          pdfUrl: '',
          note: '',
          card: '',
        }
      }
      // 参数表只有 { brief, quality }：其余在本地解析，省下每轮约 650 token 的常驻 schema。
      const parsed = parseBrief(typeof raw.brief === 'string' ? raw.brief : '')
      // 用户说得笼统 → 立刻给卡片，不猜参数、也不先跑一遍模型。
      // 弹卡条件：年级/科目缺一个；或题型、题数一个都没说（「初一数学试卷」这种没说几道什么题，
      // 直接出会变成 5 道选择题，跟用户心里的「一套卷子」差很远，先弹卡让他定）。
      if (
        !parsed.explicitGrade ||
        !parsed.explicitSubject ||
        // 「出一套模拟高考数学卷」虽然没点题数题型，但意图是整张卷子 ——
        // 卷面规格已经写死（高考 19 题），再弹卡问「几道题」纯属添乱。
        (!parsed.explicitCount && !parsed.explicitTypes && !parsed.explicitSheet) ||
        parsed.wantCard
      ) {
        const mode = parsed.mode ?? 'paper'
        const preset: Record<string, unknown> = {
          grade: parsed.grade,
          subject: parsed.subject,
          scope: parsed.scope,
          // 用户没说几道题 → 不把 5 道这种默认值写进卡片，让 buildParamCard 按真实卷面
          // （初中 22 / 高中 18）取默认题量，否则点「生成试卷」出来又是 5 道。
          ...(parsed.explicitCount ? { count: parsed.count } : {}),
          difficulty: parsed.difficulty,
          types: parsed.types,
          withAnswer: parsed.withAnswer,
        }
        pendingCardPreset = { mode, preset }
        return {
          ok: false,
          text: '',
          pdfUrl: '',
          note: '',
          card: cardCall(mode, preset),
        }
      }
      const quality = raw.quality === 'turbo' ? 'turbo' : 'premium'
      // 局部对象沿用旧名字 args，下面各分支的逻辑不用改
      const args = {
        mode: parsed.mode,
        grade: parsed.grade,
        subject: parsed.subject,
        scope: parsed.scope,
        // 用户没说几道题 → 不传 count，让 normalizePaperParams 按「真实卷面」取完整题量
        // （初中 22 题、高中 18 题）。说「5 道」才按 5 出，用于快速试出。
        count: parsed.explicitCount ? parsed.count : undefined,
        difficulty: parsed.difficulty,
        types: parsed.types === 'mixed' ? undefined : parsed.types,
        withAnswer: parsed.withAnswer,
        textbook: '人教版' as string | undefined,
        lesson: undefined as string | undefined,
        ratio: 0.6,
        // 提速：默认 auto —— 先题库直出（0 token、毫秒级），题库凑不够才让模型补差额。
        // 只有显式 quality=turbo 才锁死 bank-only（宁缺毋慢）。
        source: (quality === 'turbo' ? 'bank' : 'auto') as 'auto' | 'bank' | 'model',
        export: 'pdf' as 'pdf' | 'none',
      }
      try {
        // ——— 教学讲义：默认让模型按讲义骨架写（题库那批是诊断题，搬进讲义太干）———
        // turbo 档仍然走题库，0 token；premium 档走模型，例题带完整推理链。
        if ((args.mode ?? 'paper') === 'lesson') {
          const lessonParams = {
            grade: args.grade ?? '初一',
            subject: args.subject ?? '数学',
            topic: args.scope ?? '',
            count: args.count ?? 4,
            difficulty: args.difficulty ?? '中等',
          }
          let lesson:
            | ReturnType<typeof lessonFromModel>
            | ReturnType<typeof buildLesson>
          if (quality === 'premium') {
            const generated = await generateLesson(llm, defaults, lessonParams)
            lesson = lessonFromModel(generated.value, lessonParams)
          } else {
            const index = await getBank()
            lesson = buildLesson(index, { ...lessonParams, withAnswer: args.withAnswer !== false })
          }
          const text = renderLessonText(lesson)
          let lessonPdf: SavedPdf | null = null
          const lessonOrigin = currentOrigin()
          if (args.export !== 'none' && lessonOrigin) {
            const { buffer, pages } = await renderLessonPdf(
              {
                title: lesson.title,
                topic: lesson.topic,
                grade: args.grade ?? '初一',
                sections: lesson.sections,
                example: lesson.example,
                exercises: lesson.exercises,
              },
              { withAnswer: args.withAnswer !== false },
            )
            const saved = savePdf(
              `${lesson.title}.pdf`.replace(/[\\/:*?"<>|]/g, '-'),
              buffer,
              lessonOrigin,
              pages,
            )
            lessonPdf = saved
          }
          return {
            ok: true,
            text,
            pdfUrl: lessonPdf?.localPath || lessonPdf?.url || '',
            note: `教学讲义 · 题库整理 · 0 token · 练习 ${lesson.exercises.length} 道`,
          }
        }

        // ——— 专项突破：题库按知识点聚一组递进题，0 token ———
        if ((args.mode ?? 'paper') === 'drill') {
          const index = await getBank()
          const drill = buildDrill(index, {
            grade: args.grade ?? '初一',
            subject: args.subject ?? '数学',
            topic: args.scope ?? '',
            count: args.count ?? Math.max(5, 6),
            difficulty: args.difficulty ?? '中等',
            // 专项默认单选题：同一个知识点、同一种题型，才叫「专项」。
            types: args.types ?? 'choice',
            withAnswer: args.withAnswer !== false,
          })
          const text = renderDrillText(drill)
          let drillPdf: SavedPdf | null = null
          const drillOrigin = currentOrigin()
          if (args.export !== 'none' && drillOrigin) {
            const { buffer, pages } = await renderDrillPdf(drill, { withAnswer: args.withAnswer !== false })
            const saved = savePdf(
              `${drill.title}.pdf`.replace(/[\\/:*?"<>|]/g, '-'),
              buffer,
              drillOrigin,
              pages,
            )
            drillPdf = saved
          }
          return {
            ok: true,
            text,
            pdfUrl: drillPdf?.localPath || drillPdf?.url || '',
            note: `专项突破 · 题库整理 · 0 token · 变式 ${drill.variations.length} 道`,
          }
        }

        // ——— 知识图谱：纯本地聚合题库章节，0 token ———
        if ((args.mode ?? 'paper') === 'graph') {
          const index = await getBank()
          const tree = buildKnowledgeTree(index, {
            subject: args.subject ?? '数学',
            grade: args.grade,
          })
          const text = renderGraphText(tree)
          let graphPdf: SavedPdf | null = null
          const graphOrigin = currentOrigin()
          if (args.export !== 'none' && graphOrigin) {
            const { buffer, pages } = await renderGraphPdf(tree)
            const saved = savePdf(
              `${tree.title}.pdf`.replace(/[\\/:*?"<>|]/g, '-'),
              buffer,
              graphOrigin,
              pages,
            )
            graphPdf = saved
          }
          return {
            ok: true,
            text,
            pdfUrl: graphPdf?.localPath || graphPdf?.url || '',
            note: `知识图谱 · 题库整理 · 0 token · 覆盖 ${tree.totalQuestions} 道题`,
          }
        }

        const outcome = await generateContent(llm, defaults, {
          mode: args.mode ?? 'paper',
          params: {
            grade: args.grade,
            subject: args.subject,
            scope: args.scope,
            count: args.count,
            difficulty: args.difficulty,
            types: args.types,
            withAnswer: args.withAnswer,
            textbook: args.textbook,
            lesson: args.lesson,
            ratio: args.ratio,
          },
          source: (args.source as 'auto' | 'bank' | 'model' | undefined) ?? 'model',
        })

        let pdf: SavedPdf | null = null
        const origin = currentOrigin()
        if (args.export !== 'none' && origin) {
          pdf = await exportPaperPdf(outcome, args.withAnswer !== false, origin)
        }

        const body = renderPaperText(
          outcome.title,
          outcome.questions,
          args.withAnswer !== false,
          outcome.meta?.origin,
          outcome.meta?.model,
        )
        const src =
          outcome.meta?.origin === 'bank'
            ? '题库直出 · 0 token'
            : outcome.meta?.origin === 'mixed'
              ? '题库补题 + 模型'
              : '模型生成'
        const who = outcome.meta?.model ? ` · ${outcome.meta.model}` : ''
        return {
          ok: true,
          text: body,
          pdfUrl: pdf?.localPath || pdf?.url || '',
          note: `${outcome.title} · ${outcome.questions.length} 题 · ${src}${who} · ${outcome.meta?.elapsedMs ?? 0}ms`,
        }
      } catch (error) {
        // 所有错误包装成 QuizError：前端只渲染一句话，永不展示 raw stack。
        const message = error instanceof QuizError ? error.userMessage : '出题过程出错，请重试'
        return { ok: false, text: message, pdfUrl: '', note: '' }
      }
    },
  }))

  registerKnowledgeCatalogTool(ctx)
  registerParamCard(ctx)
  registerCardPatch(ctx)
  // exam_bank_add 不再注册成工具：它常驻约 477 token，而加题这件事题库管理页
  // （/exam-bank 的「新增题目」「导入 JSON」）已经能做，没必要让每轮对话都为它付费。

  const adminPath = registerAdminPage(ctx as unknown as Parameters<typeof registerAdminPage>[0], {
    dir: seedDir(),
    enabled: process.env.DSH_EXAM_ADMIN !== '0',
    isOn: () => runtimeEnabled,
    setOn: (on) => {
      runtimeEnabled = on
      writeConfig({ enabled: on })
      console.log(`[dsh-exam-gen] 出题开关 → ${on ? '启用' : '关闭'}`)
      return runtimeEnabled
    },
  })

  console.log(
    `[dsh-exam-gen] ready — tools=${describe(ctx)}` + (adminPath ? ` — 题库管理页 ${adminPath}` : ''),
  )

  checkCardPatch()
}

/**
 * 启动时自检并补上 dsh-tool-cards 的提交路由补丁。
 *
 * 为什么不放 postinstall：pnpm 10 默认不执行依赖构建脚本，遇到 postinstall 会直接抛
 * `ERR_PNPM_IGNORED_BUILDS` 让 `dsh plugin add` 失败——陌生人装插件不该先学
 * `pnpm approve-builds`。这里在启动时自己补，装的时候一个脚本都不跑。
 */
function checkCardPatch(): void {
  const result = ensureCardPatch()
  switch (result.outcome) {
    case 'patched':
      console.log(`[dsh-exam-gen] 参数卡片提交路由已自动修正（405 → 正常）：${result.detail}`)
      break
    case 'already':
    case 'no-tool-cards':
      break // 无需提示
    case 'version-untouched':
    case 'pattern-miss':
      console.warn(
        `[dsh-exam-gen] 卡片补丁未生效：${result.detail}。\n` +
          '卡片能显示，但点提交会 405。出卷、导出 PDF、题库管理页不受影响。',
      )
      break
    case 'write-failed':
      console.warn(
        `[dsh-exam-gen] 卡片补丁写入失败：${result.detail}。\n` +
          '卡片能显示，但点提交会 405。可手动运行包内 scripts/patch-tool-cards.mjs。',
      )
      break
    default:
      break
  }
}

function describe(ctx: Context): string {
  return ['generate_content', 'exam_card_spec', 'exam_knowledge_catalog']
    .filter((toolName) => ctx.tools.get(toolName) !== undefined)
    .join(',')
}

/**
 * 落盘目录：所有卷子都写到这里，用户「打开就能用」，不靠一个会过期的网址。
 */
const PDF_OUT_DIR = join(homedir(), 'Downloads', 'DSH出题')

interface SavedPdf {
  url: string
  localPath: string
  pages: number
  bytes: number
}

/**
 * 用系统默认程序打开本地文件。
 *
 * 这里踩过一个坑：原来写的是 `spawn('cmd', ['/c','start','',filePath], { shell: true })`。
 * `shell: true` 会把整条命令拼成一个字符串再交给 cmd，文件名里的「·」「（」「空格」
 * 在那一步被当成参数分隔符拆开，于是弹窗报「找不到 …2026-11-16T07-28-37-高三化学」——
 * 路径被截断在第一个特殊字符上。改成 windowsVerbatimArguments 自己控制引号，
 * 路径原样传进去，中文、间隔号、括号、空格都不会再断。
 */
function openLocalFile(filePath: string): void {
  try {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '""', `"${filePath}"`], {
        detached: true,
        stdio: 'ignore',
        windowsVerbatimArguments: true,
      }).unref()
    } else if (process.platform === 'darwin') {
      spawn('open', [filePath], { detached: true, stdio: 'ignore' }).unref()
    } else {
      spawn('xdg-open', [filePath], { detached: true, stdio: 'ignore' }).unref()
    }
  } catch {
    /* 打开失败不影响：文件已经写好了 */
  }
}

/**
 * 把渲染好的 PDF 同时做三件事：写进本地固定目录 → 用系统默认阅读器打开 → 保留 http 链接兜底。
 *
 * 用户要的体验是「文档已经放好了，打开就能用」，不是「点一个网址再下载」。
 * 落盘失败或打不开时退回 http 链接，功能不受影响。
 */
function savePdf(fileName: string, buffer: Buffer, origin: string, pages: number): SavedPdf {
  const id = putPdf(fileName, buffer)
  const url = `${origin}${PDF_PATH}?id=${id}`
  let localPath = ''
  try {
    mkdirSync(PDF_OUT_DIR, { recursive: true })
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filePath = join(PDF_OUT_DIR, `${ts}-${fileName}`)
    writeFileSync(filePath, buffer)
    openLocalFile(filePath)
    localPath = filePath
  } catch {
    /* 落盘失败退回 http 链接 */
  }
  return { url, localPath, pages, bytes: buffer.length }
}

/**
 * 导出 PDF：本地 pdfkit 渲染 → 写本地文件并自动打开，http 链接只作兜底。
 */
async function exportPaperPdf(
  outcome: {
    mode?: string
    title: string
    questions: PaperQuestion[]
    sync?: { textbook: string; lesson?: string; ratio: number }
    meta?: { label?: string; minutes?: number; totalPoints?: number; difficulty?: string; grade?: string; subject?: string; scope?: string }
  },
  withAnswer: boolean,
  origin: string,
): Promise<SavedPdf> {
  const paper = {
    title: outcome.title,
    questions: outcome.questions,
    meta: outcome.meta
      ? {
          label: outcome.meta.label,
          minutes: outcome.meta.minutes,
          totalPoints: outcome.meta.totalPoints,
          difficulty: outcome.meta.difficulty,
          grade: outcome.meta.grade,
          subject: outcome.meta.subject,
          scope: outcome.meta.scope,
        }
      : undefined,
  }
  // 不同功能走不同版式：同步练习页 vs 高考卷式
  const { buffer, pages } =
    outcome.mode === 'sync'
      ? await renderSyncPdf(paper, {
          withAnswer,
          textbook: outcome.sync?.textbook,
          lesson: outcome.sync?.lesson,
        })
      : await renderPaperPdf(paper, { withAnswer })
  const safeTitle = outcome.title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 60) || '试卷'
  return savePdf(`${safeTitle}.pdf`, buffer, origin, pages)
}

/**
 * 把结构化结果渲染成「能直接读/直接抄」的试卷文本。
 *
 * 为什么在这里渲染而不是让模型重述：工具结果本身就是成品，模型只需说一句「卷子在上面」。
 * 实测模型复述一遍要 1000+ output token，等于把这套流水线省下的 token 又花回去。
 */
function renderPaperText(
  title: string,
  questions: PaperQuestion[],
  withAnswer: boolean,
  origin?: string,
  model?: string,
): string {
  const total = questions.reduce((sum, question) => sum + (question.points ?? 0), 0)
  const src = origin === 'bank' ? '题库直出 · 0 token' : origin === 'mixed' ? '题库 + 模型补题' : '模型生成'
  // 把实际用的模型写出来：换模型对质量影响最大，用户要能一眼看到这次是谁出的题
  const who = model ? ` · ${model}` : ''
  const lines: string[] = [`## ${title}`, '', `共 ${questions.length} 题 · 满分 ${total} 分 · 来源：${src}${who}`, '']
  questions.forEach((question, index) => {
    const typeName =
      question.type === 'choice' ? '单选题' : question.type === 'multi' ? '多选题' : question.type === 'fill' ? '填空题' : '解答题'
    lines.push(`**${index + 1}.**（${typeName}，${question.points} 分）${question.content}`)
    if (question.options.length) {
      lines.push(question.options.map((option, i) => `${String.fromCharCode(65 + i)}. ${option}`).join('　　'))
    }
    lines.push('')
  })
  if (withAnswer) {
    lines.push('---', '', '### 参考答案', '')
    questions.forEach((question, index) => {
      lines.push(`**${index + 1}.** ${question.answerText || question.answer}`)
      if (question.analysis) lines.push(`> ${question.analysis}`)
    })
  }
  return lines.join('\n')
}


/**
 * 参数确认卡片（阶段3）。
 *
 * 关键取舍：卡片长什么样由 buildParamCard 写死，模型只输出一个几百字符的「骨架」，
 * 完整布局由 tools/post-execute 钩子在结果上补全（registerCardPatch）。
 *
 * 为什么不让模型直接输出完整载荷：只有 dsh-tool-cards 的 chat_ui 能签发提交凭证，
 * 所以卡片必须经模型调用；但 1800 字符的 JSON 让它逐字复述，实测 4/4 次都失败在
 * MALFORMED_RESPONSE（tool input is invalid JSON）。骨架方案把模型输出压到一百字符级。
 */
/**
 * 上一次弹卡时用户已经说过的参数。
 *
 * 为什么要有这个：模型调 chat_ui 时经常「精简」掉 ui.initialState（为了少输出几十个字符），
 * 结果卡片上的年级/范围全回默认值。这里在 generate_content 弹卡时把 preset 记下来，
 * 钩子补全 ui 时兜底用——单用户单轮场景足够可靠。
 */
let pendingCardPreset: { mode: CardMode; preset: Record<string, unknown> } | null = null

/**
 * 知识点目录查询工具。
 *
 * 为什么要单独做一个工具：甲方要求「每个年级、每册、每章、每个知识点、对应题型全列出来」，
 * 这是 615 条结构化数据，塞进参数卡会让卡片 JSON 爆掉（60 键上限 / 120 节点上限）。
 * 做成按需查询的工具，模型只在用户真要看目录时调一次，命中什么返回什么，常驻成本只是这段 schema。
 */
function registerKnowledgeCatalogTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'exam_knowledge_catalog',
    description:
      '查数学/物理/化学的「教材版本→学科→年级→册别→章节→知识点→题型」目录（5 个教材版本、600+ 知识点）。' +
      '支持人教版 / 北师大版 / 沪教版 / 华师大版 / 苏教版，初中上册下册、高中必修选修分层列全。' +
      '用户问「有哪些知识点/章节/题型」「北师大版初一上册数学都学什么」「沪教版初三化学目录」「高一必修一都学什么」时用。' +
      '不传参数返回总览（含各版本）；按层传 edition/subject/grade/book/chapter 逐层下钻；传 keyword 直接搜知识点。',

    parameters: {
      type: 'object',
      properties: {
        edition: { type: 'string', description: '教材版本：人教版 / 北师大版 / 沪教版 / 华师大版 / 苏教版。不传默认人教版。' },
        subject: { type: 'string', description: '学科：数学 / 物理 / 化学。不传返回全部学科。' },
        grade: { type: 'string', description: '年级：初一~高三。传了 subject 才能按年级下钻。' },
        book: { type: 'string', description: '册别：上册/下册（初中）或 必修一/必修二/选必一~三（高中）。' },
        chapter: { type: 'string', description: '章节名（可用 list 得到的原名），传了就列该章知识点+题型。' },
        keyword: { type: 'string', description: '关键词搜索知识点，如「函数」「氧气」「导数」。给它时忽略 chapter。' },
      },
      additionalProperties: false,
    },

    output: {
      schema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '目录文本文件，按层级缩进，直接念给用户即可。' },
        },
        required: ['text'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: (value as { text?: string }).text ?? '' }],
    },

    async execute(raw): Promise<{ text: string }> {
      const edition = normalizeEdition(typeof raw.edition === 'string' ? raw.edition : '')
      const subject = typeof raw.subject === 'string' && raw.subject.trim() ? raw.subject.trim() : ''
      const grade = typeof raw.grade === 'string' && raw.grade.trim() ? raw.grade.trim() : ''
      const book = typeof raw.book === 'string' && raw.book.trim() ? raw.book.trim() : ''
      const chapter = typeof raw.chapter === 'string' && raw.chapter.trim() ? raw.chapter.trim() : ''
      const keyword = typeof raw.keyword === 'string' && raw.keyword.trim() ? raw.keyword.trim() : ''
      const lines: string[] = []

      // 关键词检索优先：跨册跨章找知识点
      if (keyword) {
        const targets = subject ? [subject] : listSubjects()
        for (const subj of targets) {
          const grades = grade ? [grade] : listGrades(subj)
          for (const g of grades) {
            const hits = knowledgeOf(subj, g, keyword, edition)
            if (hits.length) {
              lines.push(`【${edition} · ${subj} · ${g}】命中 ${hits.length} 条：`)
              for (const h of hits) {
                lines.push(`  ${h.chapter} → ${h.point.name}（题型：${h.point.types.join('/')}）`)
              }
            }
          }
        }
        if (!lines.length) lines.push(`没找到与「${keyword}」相关的知识点。可以试试更短的词，如「函数」「氧气」。`,)
        return { text: lines.join('\n') }
      }

      // 逐层下钻
      if (!subject && !raw.edition) {
        const s = catalogStats()
        lines.push(
          '知识点目录总览（5 个教材版本 × 数学 / 物理 / 化学）',
          `共 ${s.subjects} 学科、${s.grades} 年级档、${s.editions} 个教材版本。`,
          '',
          '教材版本：' + listEditions().join('、'),
          '学科：' + listSubjects().join('、'),
          '',
          `人教版：${s.books} 册 / ${s.chapters} 章 / ${s.points} 个知识点；其它版本按各自教材编排另行统计。`,
          '',
          '用法：先说教材版本（ editions，如「北师大版」）+ 学科（如「数学」）看年级，再说年级看册别，',
          '再说册别看章节，再说章节看知识点和题型；也可以直接说关键词（如「沪教版高一有哪些知识点」「导数有哪些题型」）。',
        )
        return { text: lines.join('\n') }
      }
      if (!grade) {
        lines.push(`【${edition} · ${subject || '全部学科'}】${subject ? '年级：' : ''}`)
        if (subject) lines.push(...listGrades(subject).map((g) => `  · ${g}`))
        else lines.push(...listEditions().map((e) => `  · ${e}`))
        return { text: lines.join('\n') }
      }
      if (!subject) {
        lines.push(`【${edition}】学科：`, ...listSubjects().map((s) => `  · ${s}`))
        return { text: lines.join('\n') }
      }
      if (!book) {
        lines.push(`【${edition} · ${subject} · ${grade}】册别：`, ...booksOf(subject, grade, edition).map((b) => `  · ${b}`))
        if (!booksOf(subject, grade, edition).length) lines.push('  （该年级按课程安排没有此学科，或全一册）')
        return { text: lines.join('\n') }
      }
      if (!chapter) {
        lines.push(`【${edition} · ${subject} · ${grade} · ${book}】章节：`)
        for (const c of chaptersOf(subject, grade, book, edition)) {
          lines.push(`  · ${c}`)
        }
        return { text: lines.join('\n') }
      }
      // 最细一层：该章的知识点 + 题型
      const pts = pointsOf(subject, grade, book, chapter, edition)
      lines.push(`【${edition} · ${subject} · ${grade} · ${book} · ${chapter}】知识点与题型：`)
      for (const pt of pts) {
        const t = pt.types.map((x) => ({ choice: '选择', fill: '填空', solve: '解答', exp: '实验' })[x]).join('/')
        lines.push(`  · ${pt.name}（${t}题）`)
      }
      if (!pts.length) lines.push('  （没找到该章，章节名请用上面列出的原名）')
      return { text: lines.join('\n') }
    },
  }))
}

function registerParamCard(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'exam_card_spec',
    description:
      '取「出题参数卡片」的调用骨架。把返回的 call 原样交给 chat_ui，不要改动。' +
      '**只在用户明确要求自己选参数时才用**（「让我选」「打开参数卡」「我要调题型/难度/题数」）；' +
      '用户只是让你出题时，直接调 generate_content，不要走这张卡。',

    parameters: {
      type: 'object',
      properties: {
        brief: { type: 'string', description: '用户原话。' },
      },
      required: ['brief'],
      additionalProperties: false,
    },

    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', description: '成功与否。' },
          call: { type: 'string', description: 'chat_ui 参数 JSON。' },
        },
        required: ['ok', 'call'],
        additionalProperties: false,
      },
      render: (_args, value) => {
        const data = value as { ok?: boolean; call?: string }
        if (data.ok === false) return [{ type: 'text', text: '参数卡片暂不可用，直接用默认参数调 generate_content。' }]
        return [{
          type: 'text',
          text: `把下面这一行原样作为 chat_ui 的参数（不要增删字段）：\n\n${data.call ?? ''}\n\nchat_ui 返回后一句话请用户在上面选参数并点按钮，不要复述参数。`,
        }]
      },
    },

    async execute(raw): Promise<{ ok: boolean; call: string }> {
      const parsed = parseBrief(typeof raw.brief === 'string' ? raw.brief : '')
      const mode = parsed.mode as CardMode
      const preset = {
        grade: parsed.grade,
        subject: parsed.subject,
        scope: parsed.scope,
        ...(parsed.explicitCount ? { count: parsed.count } : {}),
        difficulty: parsed.difficulty,
        types: parsed.types === 'mixed' ? undefined : parsed.types,
        withAnswer: parsed.withAnswer ? 'true' : 'false',
      } as Record<string, unknown>
      pendingCardPreset = { mode, preset }
      return { ok: true, call: cardCall(mode, preset) }
    },
  }))
}

/** 把用户已经说过的参数抽成卡片预设值（没说的保持缺省，让 buildParamCard 落默认）。 */
function readPreset(args: Record<string, unknown>): Record<string, unknown> {
  const pick = (key: string): unknown => {
    const value = args[key]
    return typeof value === 'string' && value.trim() === '' ? undefined : value
  }
  const preset: Record<string, unknown> = {
    grade: pick('grade'),
    stage: pick('stage'),
    subject: pick('subject'),
    scope: pick('scope'),
    difficulty: pick('difficulty'),
    types: pick('types'),
  }
  // 多年级勾选框的布尔状态键（grade::初一 等），补卡片 initialState 用。
  for (const key of Object.keys(args)) {
    if (key.startsWith('grade::')) preset[key] = args[key]
  }
  // 用户明说题数才带进去，否则让 buildParamCard 按真实卷面取默认（初中 22 / 高中 18）
  const count = pick('count')
  if (count !== undefined) preset.count = count
  const withAnswer = pick('withAnswer')
  if (typeof withAnswer === 'boolean') preset.withAnswer = withAnswer ? 'true' : 'false'
  return preset
}

interface ToolExecLike {
  name?: string
  arguments?: Record<string, unknown>
}

interface ToolResultLike {
  value?: unknown
  isError?: boolean
}

interface ToolDecisionLike {
  kind?: string
  value?: unknown
  content?: unknown
}

/**
 * 卡片补全钩子：模型只传 `{title, ui:{schemaVersion, tree:{id:'paper', type:'Card'}}}`，
 * 这里把 value.ui 换成 buildParamCard 的完整布局。
 *
 * 三道保险：①只处理 chat_ui；②只有 tree.id 命中五个 mode 才接管（模型自己画的其它卡片放行）；
 * ③只在值校验成功（ok:true）时替换 —— 卡片凭证已经签发，替换 ui 不影响 token 归属（token 只绑会话）。
 */
function registerCardPatch(ctx: Context): void {
  const bus = ctx as unknown as {
    on(
      event: string,
      listener: (
        exec: ToolExecLike,
        result: ToolResultLike,
        next: () => Promise<ToolDecisionLike>,
      ) => Promise<ToolDecisionLike>,
    ): void
  }

  bus.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    if (decision?.kind !== 'accept' || decision.value !== undefined) return decision
    if (exec?.name !== 'chat_ui') return decision

    const args = (exec.arguments ?? {}) as {
      ui?: { tree?: { id?: unknown }; initialState?: Record<string, unknown> }
    }
    const id = args.ui?.tree?.id
    if (typeof id !== 'string' || !(MODES as readonly string[]).includes(id)) return decision

    const value = result?.value as { ok?: boolean } | undefined
    if (value?.ok !== true) return decision

    const fromModel = args.ui?.initialState
    const fallback = pendingCardPreset && pendingCardPreset.mode === id ? pendingCardPreset.preset : undefined
    pendingCardPreset = null
    const preset =
      fromModel && Object.keys(fromModel).length > 0 ? fromModel : (fallback ?? {})
    const spec = buildParamCard(id as CardMode, preset)
    return { kind: 'accept', value: { ...(value as Record<string, unknown>), ui: spec.ui } }
  })
}

