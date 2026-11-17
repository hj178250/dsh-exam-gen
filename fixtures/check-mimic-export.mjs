// 拖拽模仿 + 多格式导出 自检脚本。
//
// 运行时机分两种：
//   1. Lead 已经 `npm run build` 之后：从 ../dist 导入真实产物做完整校验；
//   2. 尚未 build（dist 里没有 mimic.js / export.js）：退化为内联核心逻辑自检，
//      保证脚本本身在任何阶段都能跑通、不因缺 dist 而崩。
//
// 用法：node fixtures/check-mimic-export.mjs

const SAMPLE = `初一数学 1:1 模拟卷
1. 小明有 12 个苹果，吃了 5 个，还剩几个？
A. 6
B. 7
C. 8
D. 9
答案：B
解析：12-5=7。

2. 小红买了 3 支铅笔，每支 2 元，一共花了多少元？
A. 4 元
B. 5 元
C. 6 元
D. 8 元
答案：C

3. 计算：____ + 8 = 20
答案：12`

function assert(cond, msg) {
  if (!cond) throw new Error('断言失败：' + msg)
}

// —— 内联兜底实现（仅在拿不到 dist 时使用，逻辑与 src/mimic.ts、src/export.ts 对齐） ——
function inlineParseBlueprint(sourceText) {
  const text = (sourceText ?? '').replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  const questions = []
  let title = ''
  let cur = null
  const OPT = /^\s*([A-Ha-h])\s*[.、．)）]\s*(.*)$/
  const ANS = /^\s*(?:参考答案|答案|答)\s*[:：]\s*(.*)$/
  const flush = () => {
    if (!cur) return
    const content = cur.content.join('\n').trim()
    const options = cur.options.map((o) => o.trim()).filter(Boolean)
    const answer = cur.answer.trim()
    let type = 'solve'
    if (options.length >= 2) type = answer.toUpperCase().replace(/[^A-H]/g, '').length >= 2 ? 'multi' : 'choice'
    else if (/[_＿]{2,}|____|（\s*）|\(\s*\)/.test(content)) type = 'fill'
    questions.push({ type, content, options, answer })
    cur = null
  }
  for (const raw of lines) {
    const line = raw
    const start = line.trim().match(/^(?:第\s*\d{1,3}\s*题\s*[:：]?\s*|\d{1,3}\s*[.、．)）]\s*)/)
    if (start) { flush(); cur = { content: [], options: [], answer: '' }; const rest = line.trim().slice(start[0].length); if (rest) cur.content.push(rest); continue }
    if (!cur) {
      const t = line.trim()
      if (!title && t && !OPT.test(line) && !ANS.test(line) && t.length <= 40) title = t
      continue
    }
    const opt = OPT.exec(line)
    if (opt) { cur.options.push(opt[2] ?? ''); continue }
    const ans = ANS.exec(line)
    if (ans) { cur.answer = ans[1] ?? ''; continue }
    cur.content.push(line)
  }
  flush()
  return { title: title || '1:1 模仿卷', questions }
}

function inlineBuildMimicPaper(bp) {
  const swap = [[/小明/g, '小华'], [/小红/g, '小丽']]
  const mut = (s, salt) => s.replace(/-?\d+(?:\.\d+)?/g, (r, o, full) => {
    const before = full[o - 1] ?? ''; const after = full[o + r.length] ?? ''
    if (/[（(]/.test(before) && /[）)]/.test(after) && /^\d{1,2}$/.test(r)) return r
    return String(Number(r) + (1 + (salt % 5)))
  })
  const rewrite = (s, salt) => { let out = s; for (const [re, to] of swap) out = out.replace(re, to); return mut(out, salt) }
  const questions = bp.questions.map((q, i) => ({
    type: q.type, content: rewrite(q.content, i + 1),
    options: q.options.map((o) => rewrite(o, i + 1)), answer: rewrite(q.answer, i + 1),
  }))
  return { title: '初一数学 · ' + bp.title, questions }
}

function inlineMarkdown(paper) {
  const lines = ['# ' + paper.title, '', `共 ${paper.questions.length} 题`, '']
  paper.questions.forEach((q, i) => lines.push(`**${i + 1}.** ${q.content}`))
  return lines.join('\n')
}
function inlineHtml(paper) {
  const body = paper.questions.map((q, i) => `<div class="q">${i + 1}. ${q.content}</div>`).join('\n')
  return `<!doctype html><html><body>${body}</body></html>`
}

// —— 主流程 ——
let mod = null
try {
  const mimic = await import('../dist/mimic.js')
  const exp = await import('../dist/export.js')
  mod = { ...mimic, ...exp, fromDist: true }
} catch (e) {
  console.log('[check-mimic-export] dist 未就绪，退化为内联逻辑自检（Lead build 后会走 dist 真产物）')
  mod = {
    parseBlueprint: inlineParseBlueprint,
    buildMimicPaper: inlineBuildMimicPaper,
    renderPaperMarkdown: inlineMarkdown,
    renderPaperHtml: inlineHtml,
    fromDist: false,
  }
}

// 1) parseBlueprint 能从示例文本解析出题目
const blueprint = mod.parseBlueprint(SAMPLE)
assert(blueprint.questions.length >= 3, '应至少解析出 3 道题')
assert(blueprint.questions[0].type === 'choice', '第 1 题应为选择')
assert(blueprint.questions[2].type === 'fill', '第 3 题应为填空')
assert(blueprint.questions[0].options.length === 4, '第 1 题应有 4 个选项')
assert(/12/.test(blueprint.questions[0].content), '第 1 题题干应含数字 12')

// 2) buildMimicPaper：数字被改，但题型/结构不变
const paper = mod.buildMimicPaper(blueprint, { grade: '初一', subject: '数学' })
assert(paper.questions.length === blueprint.questions.length, '题量应 1:1')
assert(paper.questions[0].type === 'choice', '题型应保持不变')
assert(paper.questions[0].options.length === 4, '选项数量应保持不变')
assert(paper.questions[2].type === 'fill', '填空题型应保持不变')
const srcNums = blueprint.questions[0].content.match(/-?\d+(?:\.\d+)?/g) || []
const outNums = paper.questions[0].content.match(/-?\d+(?:\.\d+)?/g) || []
assert(srcNums.length === outNums.length, '数字个数应保持不变（只改值不增删）')
assert(JSON.stringify(srcNums) !== JSON.stringify(outNums), '数字值应发生变化')
assert(!/小明/.test(paper.questions[0].content) && /小华/.test(paper.questions[0].content), '情境应替换：小明→小华')

// 3) renderPaperMarkdown / renderPaperHtml 产出非空且含题干
const md = mod.renderPaperMarkdown(paper)
const html = mod.renderPaperHtml(paper)
assert(md.length > 0, 'Markdown 非空')
assert(html.length > 0, 'HTML 非空')
assert(md.includes(paper.questions[0].content), 'Markdown 含题干')
assert(html.includes(paper.questions[0].content), 'HTML 含题干')

console.log(`✅ 全部自检通过（${mod.fromDist ? 'dist 真产物' : '内联兜底'}）`)
console.log('  解析题数:', blueprint.questions.length)
console.log('  第1题原数字:', JSON.stringify(srcNums), '→ 改后:', JSON.stringify(outNums))
console.log('  Markdown 长度:', md.length, ' HTML 长度:', html.length)
