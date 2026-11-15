import { QuizError } from '../errors.js';
/**
 * 章节名拆解：以「七上 第五章 一元一次方程 5.1.1」为例
 *   七上        → 年级层
 *   第五章 一元一次方程 → 章层
 *   5.1.1       → 节/知识点层（没有时只有两级）
 * 少数数据集的章节名是纯章节名（没有年级前缀），此时整体作为章层。
 */
const GRADE_PREFIX = /^(小学|初中|高中|[一二三四五六七八九]?[上下]|[一二三四五六七八九]年级.*)$/;
function parseChapter(chapter) {
    const parts = chapter.split(/\s+/).filter(Boolean);
    if (parts.length === 0)
        return { grade: '未分级', chapterName: chapter };
    let index = 0;
    let grade = '';
    if (GRADE_PREFIX.test(parts[0])) {
        grade = parts[0];
        index = 1;
    }
    // 结尾若是形如 5.1.1 / 3.2 / 12 的编号，视为知识点层
    let point;
    const last = parts[parts.length - 1];
    if (parts.length - index > 1 && /^[0-9]+(\.[0-9]+)*$/.test(last)) {
        point = last;
        parts.pop();
    }
    const chapterName = parts.slice(index).join(' ') || chapter;
    return { grade: grade || '未分级', chapterName, point };
}
export function buildKnowledgeTree(index, params) {
    const subject = (params.subject ?? '').trim();
    if (!subject)
        throw new QuizError('BAD_PARAMS', '请先说明科目（例如 数学）');
    const wantedGrade = (params.grade ?? '').trim();
    const items = (index.bySubject.get(subject) ?? []).filter((item) => {
        if (!wantedGrade)
            return true;
        return (item.grade ?? '').startsWith(wantedGrade) || (item.chapter ?? '').startsWith(wantedGrade);
    });
    if (items.length === 0) {
        throw new QuizError('BANK_MISS', `题库里还没有「${wantedGrade || subject}」的题，换一个科目或先加题`, 'graph');
    }
    const gradeMap = new Map();
    for (const item of items) {
        const chapter = (item.chapter ?? '').trim();
        if (!chapter)
            continue;
        const { grade, chapterName, point } = parseChapter(chapter);
        if (!gradeMap.has(grade))
            gradeMap.set(grade, new Map());
        const chapterMap = gradeMap.get(grade);
        if (!chapterMap.has(chapterName))
            chapterMap.set(chapterName, new Map());
        const pointMap = chapterMap.get(chapterName);
        const key = point ?? '';
        pointMap.set(key, (pointMap.get(key) ?? 0) + 1);
    }
    const nodes = [];
    for (const grade of [...gradeMap.keys()].sort(compareGrade)) {
        const chapterMap = gradeMap.get(grade);
        const chapterNodes = [];
        for (const chapterName of [...chapterMap.keys()].sort(compareChapter)) {
            const pointMap = chapterMap.get(chapterName);
            const points = [...pointMap.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh'));
            const chapterCount = [...pointMap.values()].reduce((sum, n) => sum + n, 0);
            chapterNodes.push({
                name: chapterName,
                level: 2,
                count: chapterCount,
                children: points.map((point) => ({
                    name: point,
                    level: 3,
                    count: pointMap.get(point) ?? 0,
                    children: [],
                })),
            });
        }
        nodes.push({
            name: grade,
            level: 1,
            count: chapterNodes.reduce((sum, node) => sum + node.count, 0),
            children: chapterNodes,
        });
    }
    return {
        title: `${wantedGrade ? `${wantedGrade}年级` : ''}${subject} · 知识结构（按题库覆盖度）`,
        nodes,
        totalQuestions: items.length,
    };
}
const CN_DIGIT = {
    一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};
/** 把「第三章 / 第十二章」的中文序号换成数字，章节列表才按课本顺序排。 */
function chapterNumber(name) {
    const match = /^第([一二三四五六七八九十百]+)章/.exec(name);
    if (!match)
        return Number.MAX_SAFE_INTEGER;
    const text = match[1];
    if (text === '十')
        return 10;
    if (text.length === 1)
        return CN_DIGIT[text] ?? Number.MAX_SAFE_INTEGER;
    // 十一 ~ 九十九
    const [tens, ones] = text.split('十');
    const tensValue = tens ? (CN_DIGIT[tens] ?? 1) : 1;
    const onesValue = ones ? (CN_DIGIT[ones] ?? 0) : 0;
    return tensValue * 10 + onesValue;
}
function compareChapter(a, b) {
    const na = chapterNumber(a);
    const nb = chapterNumber(b);
    if (na !== nb)
        return na - nb;
    return a.localeCompare(b, 'zh');
}
const GRADE_ORDER = ['小学', '七上', '七下', '八上', '八下', '九上', '九下', '高一', '高二', '高三'];
function compareGrade(a, b) {
    const ia = GRADE_ORDER.findIndex((g) => a.startsWith(g) || g.startsWith(a));
    const ib = GRADE_ORDER.findIndex((g) => b.startsWith(g) || g.startsWith(b));
    if (ia >= 0 && ib >= 0)
        return ia - ib;
    return a.localeCompare(b, 'zh');
}
/** 渲染成纯文本层级列表（对话里直接用，和 PDF 同一份内容）。 */
export function renderGraphText(result) {
    const lines = [`## ${result.title}`, '', `共 ${result.totalQuestions} 道题，覆盖 ${result.nodes.length} 个年级段。`, ''];
    result.nodes.forEach((grade, gi) => {
        lines.push(`**${gi + 1}. ${grade.name}**（${grade.count} 题）`);
        grade.children.forEach((chapter, ci) => {
            lines.push(`　${gi + 1}.${ci + 1} ${chapter.name}（${chapter.count} 题）`);
            chapter.children.forEach((point, pi) => {
                lines.push(`　　${gi + 1}.${ci + 1}.${pi + 1} 第 ${point.name} 节（${point.count} 题）`);
            });
        });
        lines.push('');
    });
    return lines.join('\n');
}
