// 从 headless JSONL 回放里抽出工具结果，存成独立 JSON 便于查看/复算。
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = process.argv[2]
const raw = readFileSync(source, 'utf8')
const line = raw.split(/\r?\n/).find((row) => row.includes('"type":"tool_result"'))
if (!line) throw new Error('no tool_result line')
const record = JSON.parse(line)
const body = record.result.split('\n\n').slice(1).join('\n\n')
writeFileSync(join(here, 'stage2-output.json'), body, 'utf8')
console.log(`saved ${body.length} chars`)
