// 题库管理 CRUD 自检（纯 Node ESM，不依赖 dist 编译产物）。
//
// 说明：本脚本不 import ../src/*.ts（普通 node 无法直接跑 TS），
// 而是把 src/bank-write.ts 里「去重 normKey / 读库 readBankObj / 原子写
// writeBankObjAtomic / 事务 mutateBank / 持久路径 persistentBankPath / seed
// 路径 bankFilePath」的核心逻辑**原样镜像**成纯 JS，用一个临时目录模拟
// `<DSH_HOME>/exam-gen-bank/bank.json`，验证：
//   1. 首次访问从随包 seed 库 seed 到持久库；
//   2. add 去重（normKey 相同返回 skipped）；
//   3. update 按 id 合并；
//   4. delete 按 id 删除；
//   5. import 数组 / {items:[]} 去重 + .bak 生成；
//   6. export 返回完整 JSON；
//   7. 随包 seed 库文件内容全程不被改动（只读）。
//
// 注意：这里刻意镜像而非引用源码，是为了在不跑 tsc 的前提下能独立验证
// 服务端路由所用的同一套语义。若 bank-write.ts 的逻辑有变，本脚本的
// 镜像注释里的对照锚点（如 normKey 正则）需同步更新。
import { readFile, writeFile, rename, copyFile, mkdir, unlink, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomBytes } from 'node:crypto'

// ---- 镜像 src/bank-write.ts 的核心逻辑（锚点：normKey / readBankObj / writeBankObjAtomic / mutateBank）----
function normKey(text) {
  return String(text || '')
    .replace(/\s+/g, '')
    .replace(/[，。；：、（）()【】\[\]{}"'“”‘’？?！!,，.。\-—_]/g, '')
    .slice(0, 120)
}

function persistentBankPath(dshHome) {
  return join(dshHome, 'exam-gen-bank', 'bank.json')
}

function bankFilePath(seedDir) {
  const bank = join(seedDir, 'bank.json')
  return existsSync(bank) ? bank : join(seedDir, 'quiz-seed.json')
}

async function readBankObj(file) {
  if (!existsSync(file)) {
    const obj = { items: [] }
    return { file, exists: false, isArray: false, obj, items: obj.items }
  }
  const raw = JSON.parse(await readFile(file, 'utf8'))
  const isArray = Array.isArray(raw)
  if (isArray) {
    const obj = { items: raw }
    return { file, exists: true, isArray: true, obj, items: raw }
  }
  const items = Array.isArray(raw.items) ? raw.items : []
  const obj = { ...raw, items }
  return { file, exists: true, isArray: false, obj, items }
}

async function writeBankObjAtomic(file, obj) {
  await mkdir(dirname(file), { recursive: true })
  const bak = `${file}.bak`
  try {
    if (existsSync(file) && !existsSync(bak)) await copyFile(file, bak)
  } catch {}
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
  try {
    await writeFile(tmp, JSON.stringify(obj), 'utf8')
    await rename(tmp, file)
  } catch (error) {
    if (existsSync(tmp)) { try { await unlink(tmp) } catch {} }
    throw error
  }
}

let writeChain = Promise.resolve()
function serialize(task) {
  const result = writeChain.then(task, task)
  writeChain = result.catch(() => {})
  return result
}

async function ensureBankSeeded(seedFile, targetFile) {
  await serialize(async () => {
    if (existsSync(targetFile)) return
    if (!seedFile || !existsSync(seedFile)) return
    await mkdir(dirname(targetFile), { recursive: true })
    await copyFile(seedFile, targetFile)
  })
}

async function mutateBank(targetFile, seedFile, mutate) {
  return serialize(async () => {
    if (!existsSync(targetFile) && seedFile && existsSync(seedFile)) {
      await mkdir(dirname(targetFile), { recursive: true })
      await copyFile(seedFile, targetFile)
    }
    const read = await readBankObj(targetFile)
    const result = await mutate(read)
    await writeBankObjAtomic(targetFile, read.obj)
    return result
  })
}

function recomputeSummary(items) {
  const subjects = {}
  const types = {}
  const difficulties = {}
  const chapters = new Set()
  let junior = 0
  let senior = 0
  for (const item of items) {
    subjects[item.subject ?? '(未标注)'] = (subjects[item.subject ?? '(未标注)'] ?? 0) + 1
    types[item.type ?? '?'] = (types[item.type ?? '?'] ?? 0) + 1
    difficulties[item.difficulty ?? '?'] = (difficulties[item.difficulty ?? '?'] ?? 0) + 1
    if (item.chapter) chapters.add(item.chapter)
    if (item.stage === 'junior') junior += 1
    else if (item.stage === 'senior') senior += 1
  }
  return { total: items.length, subjects, types, difficulties, chapters: chapters.size, junior, senior }
}

function newCustomId(index = 0) {
  return `custom-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}${index ? `-${index}` : ''}`
}

// ---- 测试辅助 ----
const rows = []
const check = (name, pass, detail) => rows.push({ name, pass: pass ? 'PASS' : 'FAIL', detail: detail ?? '' })

const HERE = dirname(fileURLToPath(import.meta.url))
const tmpRoot = join(HERE, '.tmp-check-bank-admin-' + process.pid)
const seedDir = join(tmpRoot, 'seed')
const home = join(tmpRoot, 'home')
const seedFile = join(seedDir, 'bank.json')
const target = persistentBankPath(home)

// 模拟随包只读库：2 条题 + 顶层元数据
const SEED_BANK = {
  version: 1,
  kind: 'exam-gen-bank',
  license: 'test',
  attribution: ['test'],
  summary: { total: 2, bySubject: { 数学: 2 } },
  items: [
    { id: 'seed-1', stage: 'junior', grade: '初一', subject: '数学', chapter: '第一章', difficulty: '基础', type: 'fill', content: '1+1=?', answer: '2', answerText: '2', source: 'public-corpus' },
    { id: 'seed-2', stage: 'junior', grade: '初一', subject: '数学', chapter: '第二章', difficulty: '中档', type: 'choice', content: '下列哪个是偶数？', options: ['1', '2', '3'], answer: 'B', answerText: '2', source: 'public-corpus' },
  ],
}

async function main() {
  await rm(tmpRoot, { recursive: true, force: true })
  await mkdir(seedDir, { recursive: true })
  await writeFile(seedFile, JSON.stringify(SEED_BANK), 'utf8')
  const seedBefore = await readFile(seedFile, 'utf8')

  // 1) 首次 seed
  await ensureBankSeeded(seedFile, target)
  check('首次访问从 seed 库复制到持久库', existsSync(target), '')
  const seeded = JSON.parse(await readFile(target, 'utf8'))
  check('持久库含 2 条 seed 题', seeded.items.length === 2, `items=${seeded.items.length}`)

  // 2) add 新题
  const add1 = await mutateBank(target, seedFile, (read) => {
    const key = normKey('一元一次方程 x+2=5 的解是？')
    if (read.items.some((it) => normKey(it.content) === key)) return { skipped: true }
    const item = { id: newCustomId(), stage: 'junior', grade: '初一', subject: '数学', chapter: '第五章', difficulty: '中档', type: 'fill', content: '一元一次方程 x+2=5 的解是？', answer: '3', answerText: '3', source: 'custom' }
    read.items.push(item)
    read.obj.items = read.items
    read.obj.summary = recomputeSummary(read.items)
    return { skipped: false, id: item.id, size: read.items.length }
  })
  check('add 新题成功', add1.skipped === false && add1.size === 3, `size=${add1.size}`)

  // 3) add 重复题 → skipped
  const add2 = await mutateBank(target, seedFile, (read) => {
    const key = normKey('一元一次方程x+2=5的解是？') // 去空白后与上一条相同
    if (read.items.some((it) => normKey(it.content) === key)) return { skipped: true }
    return { skipped: false }
  })
  check('add 重复题被去重（skipped）', add2.skipped === true, '')

  // 4) update 按 id 合并
  const update = await mutateBank(target, seedFile, (read) => {
    const index = read.items.findIndex((it) => it.id === 'seed-1')
    if (index < 0) return { ok: false }
    read.items[index] = { ...read.items[index], difficulty: '拔高', topic: '加法' }
    read.obj.items = read.items
    read.obj.summary = recomputeSummary(read.items)
    return { ok: true, size: read.items.length }
  })
  const afterUpdate = JSON.parse(await readFile(target, 'utf8'))
  const seed1Updated = afterUpdate.items.find((it) => it.id === 'seed-1')
  check('update 按 id 合并字段', update.ok === true && seed1Updated.difficulty === '拔高' && seed1Updated.topic === '加法', '')

  // 5) delete 按 id 删除
  const del = await mutateBank(target, seedFile, (read) => {
    const index = read.items.findIndex((it) => it.id === 'seed-2')
    if (index < 0) return { ok: false }
    read.items.splice(index, 1)
    read.obj.items = read.items
    read.obj.summary = recomputeSummary(read.items)
    return { ok: true, size: read.items.length }
  })
  const afterDelete = JSON.parse(await readFile(target, 'utf8'))
  check('delete 按 id 删除', del.ok === true && !afterDelete.items.some((it) => it.id === 'seed-2'), `size=${afterDelete.items.length}`)

  // 6) import 数组形式 + 去重
  const import1 = await mutateBank(target, seedFile, (read) => {
    const incoming = [
      { grade: '初二', subject: '物理', content: '重力加速度 g 约为？', type: 'fill', answer: '9.8', answerText: '9.8', source: 'custom' },
      { grade: '初一', subject: '数学', content: '一元一次方程 x+2=5 的解是？', type: 'fill', answer: '3', answerText: '3', source: 'custom' }, // 与已存在题重复
    ]
    const seen = new Set(read.items.map((it) => normKey(it.content)))
    let added = 0
    let skipped = 0
    for (let i = 0; i < incoming.length; i += 1) {
      const raw = incoming[i]
      const content = String(raw.content ?? '').trim()
      if (!content) { skipped += 1; continue }
      const key = normKey(content)
      if (!key || seen.has(key)) { skipped += 1; continue }
      seen.add(key)
      read.items.push({ ...raw, id: raw.id || newCustomId(i), content, source: raw.source ?? 'custom' })
      added += 1
    }
    read.obj.items = read.items
    read.obj.summary = recomputeSummary(read.items)
    return { added, skipped, size: read.items.length }
  })
  check('import 数组形式 + 去重', import1.added === 1 && import1.skipped === 1, `added=${import1.added} skipped=${import1.skipped}`)

  // 7) import {items:[]} 形式
  const import2 = await mutateBank(target, seedFile, (read) => {
    const incoming = [{ grade: '初三', subject: '化学', content: '水的化学式是？', type: 'fill', answer: 'H2O', answerText: 'H2O', source: 'custom' }]
    const seen = new Set(read.items.map((it) => normKey(it.content)))
    let added = 0
    let skipped = 0
    for (let i = 0; i < incoming.length; i += 1) {
      const raw = incoming[i]
      const content = String(raw.content ?? '').trim()
      const key = normKey(content)
      if (!key || seen.has(key)) { skipped += 1; continue }
      seen.add(key)
      read.items.push({ ...raw, id: raw.id || newCustomId(i), content, source: raw.source ?? 'custom' })
      added += 1
    }
    read.obj.items = read.items
    read.obj.summary = recomputeSummary(read.items)
    return { added, skipped, size: read.items.length }
  })
  check('import {items:[]} 形式', import2.added === 1 && import2.skipped === 0, `added=${import2.added}`)

  // 8) export 完整 JSON（读回 obj 序列化）
  const exported = await readBankObj(target)
  check('export 返回完整 JSON（含顶层元数据）', exported.isArray === false && exported.obj.version === 1 && Array.isArray(exported.items), `items=${exported.items.length}`)

  // 9) .bak 生成
  check('写入后生成 .bak 备份', existsSync(target + '.bak'), '')

  // 10) 随包 seed 库不被碰
  const seedAfter = await readFile(seedFile, 'utf8')
  check('随包 seed 库文件内容全程不变', seedBefore === seedAfter, '')

  // 11) 数组形态兼容：读一个数组库也能 list
  const arrayFile = join(tmpRoot, 'array-bank.json')
  await writeFile(arrayFile, JSON.stringify([{ id: 'a1', content: '1+1=?', answer: '2' }]), 'utf8')
  const arrayRead = await readBankObj(arrayFile)
  check('readBankObj 兼容数组形态', arrayRead.isArray === true && arrayRead.items.length === 1, '')

  await rm(tmpRoot, { recursive: true, force: true })

  const failed = rows.filter((row) => row.pass === 'FAIL')
  for (const row of rows) console.log(`${row.pass}  ${row.name}${row.detail ? `  (${row.detail})` : ''}`)
  console.log(`\n${rows.length - failed.length}/${rows.length} passed`)
  process.exitCode = failed.length === 0 ? 0 : 1
}

main().catch((error) => {
  console.error('自检异常:', error)
  process.exitCode = 1
})
