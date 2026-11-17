// 一次性验证：admin-server 写路由的持久库链路（mutateBank/ensureBankSeeded/去重口径统一）
// 用临时 DSH_HOME，避免污染真实 ~/.dsh/exam-gen-bank
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { mutateBank, ensureBankSeeded, readBankObj, persistentBankPath, bankFilePath, normKey } = require('../dist/bank-write.js')
const { seedDir } = require('../dist/retrieve.js')

const tmp = mkdtempSync(join(tmpdir(), 'eg-bank-'))
const target = persistentBankPath(tmp)
const seed = bankFilePath(seedDir())

let failed = 0
const check = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (!cond) failed++ }

await ensureBankSeeded(seed, target)
const before = await readBankObj(target)
check('首次 seed 后持久库有题', before.items.length > 0)

// 加一道题（模拟 add 路由）
const key = '测试持久库写入链路这道题独一无二'
await mutateBank(target, seed, (read) => {
  read.items.push({ id: 'test-1', content: key, subject: '数学', grade: '初一', type: 'choice', options: ['A', 'B'], answer: 'A', source: 'custom' })
  read.obj.items = read.items
  return { ok: true }
})
const after = await readBankObj(target)
check('add 后题数 +1', after.items.length === before.items.length + 1)
check('add 的题可查到', after.items.some((it) => normKey(it.content) === normKey(key)))

// 去重口径：再 add 同题干应跳过（模拟 add 路由的 seen 判断）
const dup = await mutateBank(target, seed, (read) => {
  if (read.items.some((it) => normKey(it.content) === normKey(key))) return { skipped: true }
  return { skipped: false }
})
check('同题干去重跳过', dup.skipped === true)

// 删题（模拟 delete 路由）
await mutateBank(target, seed, (read) => {
  const i = read.items.findIndex((it) => it.id === 'test-1')
  if (i >= 0) read.items.splice(i, 1)
  read.obj.items = read.items
  return { ok: true }
})
const afterDel = await readBankObj(target)
check('delete 后题数回退', afterDel.items.length === before.items.length)

// 导入（模拟 import 路由）
await mutateBank(target, seed, (read) => {
  const seen = new Set(read.items.map((it) => normKey(it.content)))
  const incoming = [{ content: '导入题A', subject: '数学', type: 'choice' }, { content: '导入题B', subject: '数学', type: 'fill' }]
  let added = 0
  for (const raw of incoming) {
    if (!seen.has(normKey(raw.content))) { seen.add(normKey(raw.content)); read.items.push({ id: 'imp-' + raw.content, ...raw, source: 'custom' }); added++ }
  }
  read.obj.items = read.items
  return { added }
})
const afterImp = await readBankObj(target)
check('导入后 +2', afterImp.items.length === before.items.length + 2)

check('随包原始库未被污染（只写持久库）', (() => {
  const raw = JSON.parse(readFileSync(seed, 'utf8'))
  const items = Array.isArray(raw) ? raw : raw.items
  return !items.some((it) => normKey(it.content) === normKey(key))
})())

check('持久库已落盘文件存在', existsSync(target))
check('持久库 .bak 已生成', existsSync(target + '.bak'))

rmSync(tmp, { recursive: true, force: true })
console.log(failed === 0 ? '✅ ALL PASS' : `❌ ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
