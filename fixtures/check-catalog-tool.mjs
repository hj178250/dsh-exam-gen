import {
  listSubjects, listGrades, listBooks, listChapters, listPoints, findKnowledge, catalogStats,
} from '../dist/knowledge-catalog.js'

console.log('STATS', JSON.stringify(catalogStats()))
console.log('SUBJECTS', JSON.stringify(listSubjects()))
console.log('GRADES 数学', JSON.stringify(listGrades('数学')))
console.log('BOOKS 数学 高一', JSON.stringify(listBooks('数学', '高一')))
console.log('CHAPTERS 数学 高一 必修一', JSON.stringify(listChapters('数学', '高一', '必修一')))
const pts = listPoints('数学', '高一', '必修一', '第1章 集合与常用逻辑用语')
console.log('POINTS 第1章', JSON.stringify(pts.slice(0, 3)))
console.log('FIND 氧气', JSON.stringify(findKnowledge('化学', '初三', '氧气').slice(0, 2)))
