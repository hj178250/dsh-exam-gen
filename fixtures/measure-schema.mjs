// 量一下「工具说明书」的常驻成本：这段文本每次请求都会发给模型。
// 中文按 1 字≈1 token、英文/符号按 4 字符≈1 token 粗算，够用来看趋势。
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')

function slice(name) {
  const start = src.indexOf(`name: '${name}'`)
  if (start < 0) return ''
  const end = src.indexOf('async execute', start)
  return src.slice(start, end < 0 ? undefined : end)
}

function tokens(text) {
  let cjk = 0
  let other = 0
  for (const ch of text) {
    if (/[\u3400-\u9fff\uff00-\uffef\u3000-\u303f]/.test(ch)) cjk += 1
    else other += 1
  }
  return Math.round(cjk + other / 4)
}

for (const name of ['generate_content', 'exam_card_spec', 'exam_bank_add']) {
  const chunk = slice(name)
  if (!chunk) {
    console.log(`${name}: 未找到`)
    continue
  }
  console.log(`${name}: ${chunk.length} 字符 ≈ ${tokens(chunk)} token`)
}

const total = ['generate_content', 'exam_card_spec', 'exam_bank_add'].map(slice).join('')
console.log(`合计常驻 ≈ ${tokens(total)} token（每次请求都付）`)
