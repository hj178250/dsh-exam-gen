// 题库直出速度 + 覆盖度实测：验证「生成慢」能否靠本地题库秒出解决。
import { getBank, seedDir } from '../dist/retrieve.js'
import { bankStats, searchBank } from '../dist/bank.js'
import { composeFromBank } from '../dist/modes/paper-bank.js'
import { normalizePaperParams } from '../dist/modes/paper.js'

console.log('SEED_DIR', seedDir())
const t0 = Date.now()
const index = await getBank()
console.log('LOAD_MS', Date.now() - t0)
console.log('STATS', JSON.stringify(bankStats(index)))

const cases = [
  { grade: '高三', subject: '数学', scope: '高考全范围', types: 'choice', count: 8 },
  { grade: '初一', subject: '数学', scope: '有理数', types: 'choice', count: 10 },
  { grade: '初三', subject: '化学', scope: '我们周围的空气', types: 'choice', count: 10 },
]
for (const c of cases) {
  const params = normalizePaperParams(c)
  const t = Date.now()
  const r = composeFromBank(index, params, false)
  const ms = Date.now() - t
  console.log(`COMPOSE ${c.grade}${c.subject}/${c.scope}: got=${r.got} missing=${r.missing} ms=${ms} chapters=${r.chapters.length}`)
  const q0 = r.result.questions[0]
  if (q0) console.log('  Q1', q0.content.slice(0, 70))
}
