// 打印「一次真实生成的输入」：与线上同一份 buildPaperPrompt 输出，附检索命中。
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPaperPrompt, normalizePaperParams } from '../dist/modes/paper.js'
import { retrieveReferences } from '../dist/retrieve.js'

const here = dirname(fileURLToPath(import.meta.url))
process.env.DSH_EXAM_SEED_DIR = here

const params = normalizePaperParams({
  grade: '初一',
  subject: '数学',
  scope: '一元一次方程',
  count: 3,
  difficulty: '中等',
  types: 'choice',
  withAnswer: true,
})
const hits = await retrieveReferences({ grade: params.grade, subject: params.subject, scope: params.scope })
const prompt = buildPaperPrompt(params, hits)

const report = [
  `# 规范化后的参数\n${JSON.stringify(params)}`,
  `# 检索命中 ${hits.length} 条（每行：分数 | 章节 | 正文）`,
  ...hits.map((hit) => `${hit.score} | ${hit.chapter ?? '-'} | ${hit.content}`),
  `# Prompt 正文（${prompt.length} 字符，中文 ${(prompt.match(/[\u4e00-\u9fff]/g) ?? []).length} 字）`,
  prompt,
].join('\n')

writeFileSync(join(here, 'stage2-prompt.txt'), report, 'utf8')
console.log(report)
