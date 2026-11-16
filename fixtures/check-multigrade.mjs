import { parseBrief } from '../dist/parse-brief.js'
import { buildParamCard } from '../dist/cards.js'

for (const b of ['初一,初二 数学卷', '高一,高二,高三 数学卷', '初一初二数学卷', '高一 高二 高三 数学', '模拟高考数学卷']) {
  const p = parseBrief(b)
  console.log(JSON.stringify({ b, grade: p.grade, grades: p.grades, exG: p.explicitGrade, sub: p.subject }))
}
const card = buildParamCard('paper', { grade: '高一,高二,高三', stage: '高考', subject: '数学', count: 19 })
console.log('CARD_GRADES', JSON.stringify(Object.fromEntries(Object.entries(card.ui.initialState).filter(([k]) => k.startsWith('grade')))))
console.log('INCLUDE_KEYS', JSON.stringify(card.ui.actions.submit.includeKeys))
