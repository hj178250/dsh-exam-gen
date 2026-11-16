import {
  listEditions, listBooksForEdition, listChaptersForEdition, listPointsForEdition,
  findKnowledgeForEdition, catalogStats, listChapters, listGrades, listSubjects,
} from '../dist/knowledge-catalog.js'

const log = []
function ok(cond, msg) {
  log.push(`${cond ? 'PASS' : 'FAIL'}  ${msg}`)
}

// 1. 版本列表
const all = listEditions()
ok(all.length === 5 && all.includes('人教版') && all.includes('北师大版') && all.includes('沪教版') && all.includes('华师大版') && all.includes('苏教版'),
  `listEditions() = ${all.join('/')}`)

// 2. 各版本数学初一上册章节（应与各版本真实教材对齐）
const bsd = listChaptersForEdition('数学', '初一', '上册', '北师大版')
ok(bsd.some(c => c.includes('丰富的图形世界')), `北师大版初一上含"丰富的图形世界" → ${bsd.length}章`)
const sh = listChaptersForEdition('数学', '初一', '上册', '沪教版')
ok(sh.some(c => c.includes('数的整除')), `沪教版初一上含"数的整除" → ${sh.length}章`)
const hsd = listChaptersForEdition('数学', '初一', '上册', '华师大版')
ok(hsd.some(c => c.includes('有理数')), `华师大版初一上含"有理数" → ${hsd.length}章`)
const js = listChaptersForEdition('数学', '初一', '上册', '苏教版')
ok(js.length > 0, `苏教版初一上 → ${js.length}章`)

// 3. 人教版一致性（版本化接口 == 原接口）
const rj_books = listBooksForEdition('数学', '高一', '人教版')
const rj_books_orig = listBooksForEdition('数学', '高一', '人教版')
ok(rj_books.join() === ['必修一', '必修二'].join(), `人教版高一册别 = ${rj_books.join('/')}`)
const rj_ch = listChaptersForEdition('数学', '高一', '必修一', '人教版')
ok(rj_ch.join() === listChapters('数学', '高一', '必修一').join(), `人教版必修一章节与原接口一致 → ${rj_ch.length}章`)

// 4. 知识点挂载非空（签名：(subject,grade,book,chapter,edition)）
const bsd_pts = listPointsForEdition('数学', '初一', '上册', bsd[0], '北师大版')
ok(bsd_pts.length > 0, `北师大版${bsd[0]} → ${bsd_pts.length}个知识点`)
const sh_pts = listPointsForEdition('数学', '初一', '上册', sh[0], '沪教版')
ok(sh_pts.length > 0, `沪教版${sh[0]} → ${sh_pts.length}个知识点`)

// 5. 关键词检索
const fk = findKnowledgeForEdition('数学', '初三', '一元二次方程', '苏教版')
ok(fk.length > 0, `苏教版初三搜"一元二次方程" → ${fk.length}条`)

// 6. 统计
const st = catalogStats()
ok(st.editions === 5, `catalogStats.editions = ${st.editions}`)
ok(st.byEdition && st.byEdition['北师大版'] && st.byEdition['北师大版'].points > 0, `北师大版统计 points=${st.byEdition['北师大版']?.points}`)
ok(st.byEdition['沪教版'] && st.byEdition['沪教版'].chapters > 0, `沪教版统计 chapters=${st.byEdition['沪教版']?.chapters}`)

console.log(log.join('\n'))
const fails = log.filter(l => l.startsWith('FAIL')).length
console.log(`\n${log.length - fails}/${log.length} passed`)
process.exit(fails ? 1 : 0)
