// 离线自测：不联网、不调模型，用假 llm 验证「校验 + 重试一次 + 错误透传」三条路径。
// 用法：node fixtures/selftest.mjs
import { generateContent } from '../dist/pipeline.js'
import { buildPaperPrompt, normalizePaperParams, validatePaper } from '../dist/modes/paper.js'
import { extractJson } from '../dist/llm.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

process.env.DSH_EXAM_SEED_DIR = join(dirname(fileURLToPath(import.meta.url)))

// answer 用选项字母（甲方 D3 定案）
const good = {
  title: '自测卷',
  questions: [{ type: 'choice', content: '1+1=?', options: ['1', '2'], answer: 'B', points: 5 }],
}
const badAnswer = {
  title: '自测卷',
  questions: [{ type: 'choice', content: '1+1=?', options: ['1', '2'], answer: 'C', points: 5 }],
}

function fakeLlm(replies) {
  const prompts = []
  let index = 0
  return {
    prompts,
    listProviders: () => [{ id: 'fake' }],
    listModels: async () => [{ id: 'fake-model' }],
    stream(options) {
      prompts.push(options.messages[0].content[0].text)
      const text = replies[Math.min(index, replies.length - 1)]
      index += 1
      return (async function* () {
        yield { type: 'text-delta', text }
        yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 50 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

const rows = []
const check = (name, pass, detail) => rows.push({ name, pass: pass ? 'PASS' : 'FAIL', detail: detail ?? '' })

// 1) 合法卷 + 字母反查选项原文
{
  const v = validatePaper(good)
  check(
    'validate 合法卷 + 字母反查选项',
    v.ok === true && v.value.questions[0].answer === 'B' && v.value.questions[0].answerText === '2',
    v.value?.questions?.[0]?.answerText,
  )
}
// 2) 答案字母越界
{
  const v = validatePaper(badAnswer)
  check('validate 拦截答案字母越界', v.ok === false && v.errors[0].includes('超出选项数量'), v.errors.join('|'))
}
// 3) 模型仍写选项原文 → 宽容归一成字母
{
  const v = validatePaper({ title: 'x', questions: [{ type: 'choice', content: 'a', options: ['甲', '乙'], answer: '乙' }] })
  check('选项原文宽容归一成字母', v.ok === true && v.value.questions[0].answer === 'B', v.ok ? '' : v.errors.join('|'))
}
// 4) withAnswer=false 允许空答案
check(
  'withAnswer=false 允许空 answer',
  validatePaper({ title: 'x', questions: [{ type: 'choice', content: 'a', options: ['甲', '乙'], answer: '' }] }, false).ok === true,
  '',
)
// 5) 空 questions
check('validate 拦截空 questions', validatePaper({ title: 'x', questions: [] }).ok === false, '')
// 6) type 越界
check(
  'validate 拦截 type 越界',
  validatePaper({ title: 'x', questions: [{ type: 'essay', content: 'a', options: [], answer: 'b' }] }).ok === false,
  '',
)
// 7) 选择题选项不足
check(
  'validate 拦截选项<2',
  validatePaper({ title: 'x', questions: [{ type: 'choice', content: 'a', options: ['A'], answer: 'A' }] }).ok === false,
  '',
)
// 8) extractJson 容错
check('extractJson 剥围栏', extractJson('```json\n{"a":1}\n```').a === 1, '')
check('extractJson 抠括号', extractJson('结果是 {"a":2} 完毕').a === 2, '')

// 9) 首次答案非法 → 自动重试一次并成功
{
  const llm = fakeLlm([JSON.stringify(badAnswer), JSON.stringify(good)])
  const out = await generateContent(llm, undefined, { mode: 'paper', source: 'model', params: { count: 1 } })
  check('首次非法 → 重试成功', out.meta.attempts === 2, `attempts=${out.meta.attempts}`)
  check('重试 prompt 回喂错误原因', llm.prompts[1].includes('超出选项数量'), '')
}

// 10) 首次不是 JSON → 重试成功
{
  const llm = fakeLlm(['抱歉，我来出一道题：1+1=2', JSON.stringify(good)])
  const out = await generateContent(llm, undefined, { mode: 'paper', source: 'model', params: { count: 1 } })
  check('首次非 JSON → 重试成功', out.meta.attempts === 2, `attempts=${out.meta.attempts}`)
}

// 11) 两次都坏 → 抛 INVALID_OUTPUT（不是 raw stack）
{
  const llm = fakeLlm([JSON.stringify(badAnswer), JSON.stringify(badAnswer)])
  let code = ''
  try {
    await generateContent(llm, undefined, { mode: 'paper', source: 'model', params: { count: 1 } })
  } catch (error) {
    code = error.code ?? ''
  }
  check('两次都坏 → INVALID_OUTPUT', code === 'INVALID_OUTPUT', code)
}

// 12) Prompt 体量
{
  const params = normalizePaperParams(undefined)
  const prompt = buildPaperPrompt(params, [])
  const cjk = (prompt.match(/[\u4e00-\u9fff]/g) ?? []).length
  // 完整卷会多一行「卷面结构」说明，预算从 900 提到 1200
  check('默认 prompt 长度', prompt.length < 1200, `${prompt.length} 字符 / 中文 ${cjk} 字`)
}

const failed = rows.filter((row) => row.pass === 'FAIL')
for (const row of rows) console.log(`${row.pass}  ${row.name}${row.detail ? `  (${row.detail})` : ''}`)
console.log(`\n${rows.length - failed.length}/${rows.length} passed`)
process.exitCode = failed.length === 0 ? 0 : 1
