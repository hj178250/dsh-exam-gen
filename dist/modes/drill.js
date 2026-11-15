import { searchBank } from '../bank.js';
import { QuizError } from '../errors.js';
const DIFF_ORDER = ['基础', '中等', '拔高'];
const TYPE_NAME = { choice: '选择题', fill: '填空题', solve: '解答题' };
/** 按题干特征说清「这题变在哪」，而不是「多练一道」。 */
function variationNote(item, index) {
    const difficulty = item.difficulty ?? '中等';
    const text = (item.content ?? '').trim();
    const hints = [];
    if (index === 0)
        hints.push('本组第一题，先看清原型考的是哪一步');
    if (/若|已知/.test(text))
        hints.push('条件藏在「若/已知」里，先翻成式子再动笔');
    if (/某|车间|班级|工人|商店|方案/.test(text))
        hints.push('情境题先把文字翻译成方程，别急着算');
    if (/求.*的?值|多少|几/.test(text))
        hints.push('问的是具体数值，最后代回原式验一遍');
    if (difficulty === '拔高')
        hints.push('多问或多条件，注意别漏第二问');
    if (difficulty === '基础')
        hints.push('直给型，套公式就能出');
    if (hints.length === 0)
        hints.push('换了问法，考点没变，看清条件');
    return hints.slice(0, 2).join('；');
}
export function buildDrill(index, params) {
    const subject = (params.subject ?? '').trim();
    if (!subject)
        throw new QuizError('BAD_PARAMS', '请先说明科目（例如 数学）');
    const topic = (params.topic ?? '').trim();
    if (!topic)
        throw new QuizError('BAD_PARAMS', '请先说明专项主题（要突破哪个知识点）');
    const pool = searchBank(index, {
        grade: params.grade,
        subject,
        scope: topic,
        difficulty: params.difficulty,
        limit: 300,
    });
    if (pool.length === 0) {
        throw new QuizError('BANK_MISS', `题库里还没有「${topic}」的题，换个主题或先往题库加题`, 'drill');
    }
    // 按难度递进：基础 → 中等 → 拔高，同难度内保持检索打分顺序
    const typed = pool.filter((item) => {
        if (!params.types)
            return true;
        if (item.type === params.types)
            return true;
        return params.types === 'solve' && item.type === 'short';
    });
    const ordered = typed
        .slice()
        .sort((a, b) => DIFF_ORDER.indexOf(a.difficulty ?? '中等') - DIFF_ORDER.indexOf(b.difficulty ?? '中等'));
    const picked = [];
    const seen = new Set();
    for (const item of ordered) {
        if (picked.length >= params.count)
            break;
        const stem = (item.content ?? '').trim();
        if (!stem || seen.has(stem))
            continue;
        seen.add(stem);
        picked.push(item);
    }
    if (picked.length === 0) {
        throw new QuizError('BANK_MISS', `「${topic}」下没有符合该题型的题，换个题型试试`, 'drill');
    }
    const variations = picked.map((item, index) => ({
        stem: (item.content ?? '').trim(),
        answer: String(item.answerText ?? item.answer ?? '').trim(),
        explanation: (item.explanation ?? '').trim(),
        variation_note: variationNote(item, index),
        difficulty: item.difficulty ?? '中等',
    }));
    // 章节名形如「七上 第五章 一元一次方程 5.1.1」，总结里只保留到章，去掉节号
    const chapters = [
        ...new Set(picked
            .map((item) => (item.chapter ?? '').split(/\s+/).filter(Boolean).slice(0, 3).join(' '))
            .filter(Boolean)),
    ];
    const difficulties = [...new Set(variations.map((v) => v.difficulty))];
    const summary = [
        `本组覆盖：${chapters.join('、') || topic}`,
        `难度走向：${difficulties.join(' → ')}（共 ${variations.length} 道）`,
        `做题顺序：先把「${picked[0]?.difficulty ?? '基础'}」那几道做对再做后面的，错题回到对应知识点重看解析`,
    ];
    const title = `${params.grade}${subject} · ${topic}（专项突破）`;
    return {
        title,
        topic,
        variations,
        summary,
        points: picked.map((item) => (item.type === 'solve' ? 10 : item.type === 'choice' ? 3 : 4)),
    };
}
/** 对话里直接展示的文本版（和 PDF 同一份内容）。 */
export function renderDrillText(result) {
    const lines = [`## ${result.title}`, '', `${result.variations.length} 道，按难度递进排列。`, ''];
    result.variations.forEach((variation, index) => {
        lines.push(`**${index + 1}.**（${variation.difficulty}）${variation.stem}`);
        lines.push(`　变式说明：${variation.variation_note}`);
        lines.push('');
    });
    lines.push('---', '', '### 方法总结');
    result.summary.forEach((line) => lines.push(`- ${line}`));
    lines.push('', '### 答案与解析');
    result.variations.forEach((variation, index) => {
        const explain = variation.explanation ? `　解析：${variation.explanation}` : '';
        lines.push(`**${index + 1}.** ${variation.answer}${explain}`);
    });
    return lines.join('\n');
}
export { TYPE_NAME as DRILL_TYPE_NAME };
