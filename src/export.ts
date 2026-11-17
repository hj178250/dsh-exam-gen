/**
 * 多格式导出：PDF / HTML / Markdown。
 *
 * PDF 复用 pdf.ts 的 renderPaperPdf（高考卷式 A4，答案页、上下标、分式排版都在那里），
 * HTML / Markdown 是本地纯函数渲染，零模型调用、零外部依赖。
 *
 * 设计约束：
 *   · HTML 自包含（内联 CSS + 少量原生 JS），答案折叠 + 明暗主题 + 打印友好；
 *   · Markdown 对齐 renderPaperText 的口径（题号/题型/分值/答案/解析）；
 *   · exportPaperFormats 一次跑出三份产物，返回各格式的 buffer + 建议文件名。
 */
import { renderPaperPdf } from './pdf.js'
import type { PaperQuestion, PaperResult } from './modes/paper.js'

export interface ExportOptions {
  subject?: string
  grade?: string
  title?: string
  /** 是否附答案（HTML/Markdown 是否渲染答案与解析）。 */
  withAnswer?: boolean
}

export interface FormatArtifact {
  /** 建议文件名（含扩展名）。 */
  fileName: string
  mime: string
  buffer: Buffer
  /** 仅 PDF 有：页数。 */
  pages?: number
}

export interface ExportBundle {
  title: string
  pdf: FormatArtifact
  html: FormatArtifact
  markdown: FormatArtifact
}

const TYPE_LABEL: Record<string, string> = {
  choice: '单选题',
  multi: '多选题',
  fill: '填空题',
  solve: '解答题',
}

function typeName(type: string): string {
  return TYPE_LABEL[type] ?? '解答题'
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function safeTitle(title: string): string {
  return (title || '试卷').replace(/[\\/:*?"<>|]/g, '-').slice(0, 60)
}

function letter(i: number): string {
  return String.fromCharCode(65 + i)
}

function totalPoints(paper: PaperResult): number {
  return paper.questions.reduce((sum, q) => sum + (q.points || 0), 0)
}

/** 把答案文本内嵌进 data 属性，前端用 CSS 折叠，不污染正文。 */
function answerFor(q: PaperQuestion): string {
  return q.answerText || q.answer || ''
}

/** 渲染自包含 HTML（答案折叠开关、明暗主题切换、打印友好）。 */
export function renderPaperHtml(paper: PaperResult, opts: ExportOptions = {}): string {
  const withAnswer = opts.withAnswer !== false
  const title = opts.title ?? paper.title
  const grade = opts.grade ?? paper.meta?.grade ?? ''
  const subject = opts.subject ?? paper.meta?.subject ?? ''
  const total = paper.meta?.totalPoints ?? totalPoints(paper)

  const questionHtml = paper.questions
    .map((q, index) => {
      const options = (q.options ?? [])
        .map((o, i) => `<div class="opt">${letter(i)}. ${escapeHtml(o)}</div>`)
        .join('')
      const answer = escapeHtml(answerFor(q))
      const analysis = q.analysis ? `<div class="analysis">解析：${escapeHtml(q.analysis)}</div>` : ''
      const topic = q.topic ? `<div class="topic">〔知识点：${escapeHtml(q.topic)}〕</div>` : ''
      const ansBlock = withAnswer
        ? `<div class="ans">答案：${answer}${analysis}${topic}</div>`
        : ''
      return `<article class="q" data-type="${escapeHtml(q.type)}">
        <div class="q-head"><span class="q-no">${index + 1}.</span><span class="q-type">${typeName(q.type)}</span><span class="q-pts">${q.points || 0} 分</span></div>
        <div class="q-body">${escapeHtml(q.content)}</div>
        ${options ? `<div class="opts">${options}</div>` : ''}
        ${ansBlock}
      </article>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{--bg:#ffffff;--panel:#f6f7f9;--text:#1a1d23;--dim:#5b6472;--line:#e3e6ec;--brand:#2f6fed}
[data-theme="dark"]{--bg:#0f1115;--panel:#171a21;--text:#e6e8ee;--dim:#9aa3b2;--line:#262b36;--brand:#4f8cff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif}
.topbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:10px;padding:12px 18px;background:var(--panel);border-bottom:1px solid var(--line)}
.topbar h1{font-size:16px;margin:0;font-weight:600}
.topbar .sp{flex:1}
.topbar button{border:1px solid var(--line);background:transparent;color:var(--text);border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit}
.topbar button:hover{border-color:var(--brand);color:var(--brand)}
.meta{padding:10px 18px;color:var(--dim);font-size:12.5px;border-bottom:1px solid var(--line)}
main{max-width:860px;margin:0 auto;padding:18px}
.q{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:12px;page-break-inside:avoid}
.q-head{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-weight:600}
.q-no{color:var(--brand)}
.q-type{font-size:12px;color:var(--dim);font-weight:400}
.q-pts{margin-left:auto;font-size:12px;color:var(--dim);font-weight:400}
.q-body{white-space:pre-wrap}
.opts{margin-top:8px;display:flex;flex-direction:column;gap:4px}
.opt{padding:2px 0}
.ans{display:none;margin-top:10px;padding:10px 12px;border-radius:8px;background:color-mix(in srgb,var(--brand) 10%,transparent);color:var(--text);font-size:13px}
.show-ans .ans{display:block}
.analysis{color:var(--dim);margin-top:4px}
.topic{color:var(--dim);font-size:12px;margin-top:4px}
@media print{
  .topbar{display:none}
  body{background:#fff;color:#000}
  .q{background:#fff;border:1px solid #ddd}
  .ans{display:block !important;background:#f4f4f4;color:#000}
}
</style>
</head>
<body>
<div class="topbar">
  <h1>${escapeHtml(title)}</h1>
  <span class="sp"></span>
  <button id="ansToggle" type="button">显示答案</button>
  <button id="themeToggle" type="button">暗色</button>
  <button id="printBtn" type="button">打印</button>
</div>
<div class="meta">${escapeHtml(grade)} ${escapeHtml(subject)} · 共 ${paper.questions.length} 题 · 满分 ${total} 分</div>
<main id="paper">
${questionHtml}
</main>
<script>
(function(){
  var root=document.documentElement;
  var paper=document.getElementById('paper');
  var ansBtn=document.getElementById('ansToggle');
  var themeBtn=document.getElementById('themeToggle');
  ansBtn.addEventListener('click',function(){
    var show=paper.classList.toggle('show-ans');
    ansBtn.textContent=show?'隐藏答案':'显示答案';
  });
  themeBtn.addEventListener('click',function(){
    var dark=root.getAttribute('data-theme')==='dark';
    root.setAttribute('data-theme',dark?'light':'dark');
    themeBtn.textContent=dark?'暗色':'亮色';
  });
  document.getElementById('printBtn').addEventListener('click',function(){window.print();});
})();
</script>
</body>
</html>`
}

/** 渲染 Markdown（对齐 renderPaperText 口径）。 */
export function renderPaperMarkdown(paper: PaperResult, opts: ExportOptions = {}): string {
  const withAnswer = opts.withAnswer !== false
  const title = opts.title ?? paper.title
  const total = paper.meta?.totalPoints ?? totalPoints(paper)
  const lines: string[] = [`# ${title}`, '', `共 ${paper.questions.length} 题 · 满分 ${total} 分`, '']

  paper.questions.forEach((q, index) => {
    lines.push(`**${index + 1}.（${typeName(q.type)}，${q.points || 0} 分）** ${q.content}`)
    if (q.options.length) {
      lines.push(q.options.map((o, i) => `${letter(i)}. ${o}`).join('　　'))
    }
    lines.push('')
  })

  if (withAnswer) {
    lines.push('---', '', '## 参考答案', '')
    paper.questions.forEach((q, index) => {
      lines.push(`**${index + 1}.** ${answerFor(q)}`)
      if (q.analysis) lines.push(`> ${q.analysis}`)
    })
  }
  return lines.join('\n')
}

/** 一次产出 PDF + HTML + Markdown 三份产物。 */
export async function exportPaperFormats(paper: PaperResult, opts: ExportOptions = {}): Promise<ExportBundle> {
  const title = opts.title ?? paper.title
  const base = safeTitle(title)

  const { buffer: pdfBuffer, pages } = await renderPaperPdf(paper, { withAnswer: opts.withAnswer !== false })
  const htmlText = renderPaperHtml(paper, opts)
  const markdownText = renderPaperMarkdown(paper, opts)

  return {
    title,
    pdf: { fileName: `${base}.pdf`, mime: 'application/pdf', buffer: pdfBuffer, pages },
    html: { fileName: `${base}.html`, mime: 'text/html', buffer: Buffer.from(htmlText, 'utf8') },
    markdown: { fileName: `${base}.md`, mime: 'text/markdown', buffer: Buffer.from(markdownText, 'utf8') },
  }
}
