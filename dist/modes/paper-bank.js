import { searchBank } from '../bank.js';
const POINTS = { choice: 3, fill: 4, solve: 10 };
/** 把题库条目转成试卷题（题库里选择题的 answer 已经是字母，answerText 是选项原文）。 */
export function toPaperQuestion(item) {
    const type = (item.type === 'choice' || item.type === 'fill' || item.type === 'solve' ? item.type : 'fill');
    const content = (item.content ?? '').trim();
    if (!content)
        return undefined;
    const options = type === 'choice' ? (item.options ?? []).map((option) => String(option).trim()).filter(Boolean) : [];
    const rawAnswer = String(item.answer ?? '').trim();
    if (!rawAnswer)
        return undefined;
    if (type === 'choice') {
        if (options.length < 2)
            return undefined;
        const letter = /^[A-Fa-f]$/.test(rawAnswer) ? rawAnswer.toUpperCase() : '';
        const byText = options.findIndex((option) => option === rawAnswer);
        const finalLetter = letter || (byText >= 0 ? String.fromCharCode(65 + byText) : '');
        if (!finalLetter)
            return undefined;
        const index = finalLetter.charCodeAt(0) - 65;
        if (index >= options.length)
            return undefined;
        return {
            type,
            content,
            options,
            answer: finalLetter,
            answerText: String(item.answerText ?? options[index] ?? ''),
            points: POINTS.choice,
            analysis: item.explanation,
        };
    }
    return {
        type,
        content,
        options: [],
        answer: rawAnswer,
        answerText: String(item.answerText ?? rawAnswer),
        points: POINTS[type] ?? 4,
        analysis: item.explanation,
    };
}
/**
 * 从题库拼一份卷子。
 *
 * 选题策略：先用 searchBank 按 年级/学科/范围/难度 打分拿到候选池，
 * 再按「章节命中优先 → 难度接近 → id 稳定排序」挑 count 道，保证同一请求结果可复现。
 *
 * strictType=true 时不混入其它题型（宁缺勿滥）：题型一旦混进卷子，模型看到就会自作主张
 * 把填空题改写成选择题，等于把「题库直出」的确定性又还给了模型。
 * 只有 source=bank（用户明确只要本地库）时才允许放宽题型凑数。
 */
export function composeFromBank(index, params, strictType = true) {
    const pool = searchBank(index, {
        grade: params.grade,
        subject: params.subject,
        scope: params.scope,
        difficulty: params.difficulty,
        limit: 200,
    });
    const wanted = params.types;
    const picked = [];
    const seen = new Set();
    const chapters = new Set();
    // 第一轮：严格同题型
    for (const item of pool) {
        if (picked.length >= params.count)
            break;
        if (item.type !== wanted && !(wanted === 'solve' && item.type === 'short'))
            continue;
        const question = toPaperQuestion(item);
        if (!question)
            continue;
        if (seen.has(question.content))
            continue;
        seen.add(question.content);
        picked.push(item);
        if (item.chapter)
            chapters.add(item.chapter);
    }
    // 第二轮：题型放宽（仅 source=bank 时允许，用其它题型补齐，仍不调模型）
    if (!strictType && picked.length < params.count) {
        for (const item of pool) {
            if (picked.length >= params.count)
                break;
            if (picked.includes(item))
                continue;
            const question = toPaperQuestion(item);
            if (!question)
                continue;
            if (seen.has(question.content))
                continue;
            seen.add(question.content);
            picked.push(item);
            if (item.chapter)
                chapters.add(item.chapter);
        }
    }
    const questions = picked
        .map(toPaperQuestion)
        .filter((question) => question !== undefined);
    return {
        result: {
            title: buildTitle(params),
            questions,
            meta: {
                grade: params.grade,
                subject: params.subject,
                difficulty: params.difficulty,
                scope: params.scope,
            },
        },
        got: questions.length,
        missing: Math.max(0, params.count - questions.length),
        chapters: [...chapters],
    };
}
function buildTitle(params) {
    // 标题只放「谁 + 考什么」，难度/题型这类信息放卷头小字里 —— 甲方明确说标题上不要堆这些。
    const scope = (params.scope ?? '').trim();
    const base = `${params.grade}${params.subject}`;
    if (!scope)
        return `${base} · 单元测试卷`;
    return `${base} · ${scope}`;
}
function topicOf(item) {
    const topic = (item.topic ?? '').trim();
    if (topic)
        return topic;
    const chapter = (item.chapter ?? '').trim();
    // 章节名形如「七上 第五章 一元一次方程 5.1.1」→ 取最后两段当知识点
    const parts = chapter.split(/\s+/).filter(Boolean);
    return parts.slice(-2).join(' ') || chapter;
}
/**
 * 教材同步（mode = 'sync'）：同一个章节里，按基础/提高两档分别取题。
 *
 * 与智能组卷的区别只在「分档」和「标知识点」——所以不重写选题逻辑，复用 searchBank 的排序，
 * 只是按 difficulty 分成两组各取所需数量。仍然是 0 token 的本地拼装。
 */
export function composeSync(index, params) {
    const pool = searchBank(index, {
        grade: params.grade,
        subject: params.subject,
        scope: params.scope,
        difficulty: params.difficulty,
        limit: 300,
    });
    const ratio = Math.min(0.9, Math.max(0.2, params.ratio ?? 0.6));
    const basicCount = Math.max(1, Math.round(params.count * ratio));
    const advancedCount = Math.max(0, params.count - basicCount);
    const basic = [];
    const advanced = [];
    const seen = new Set();
    const chapters = new Set();
    const take = (bucket, want, isBasic) => {
        for (const item of pool) {
            if (basic.length + advanced.length >= params.count)
                return;
            if (bucket.length >= want)
                return;
            if (bucket.includes(item) || basic.includes(item) || advanced.includes(item))
                continue;
            const isBasicItem = item.difficulty === '基础';
            if (isBasic !== isBasicItem)
                continue;
            const question = toPaperQuestion(item);
            if (!question)
                continue;
            if (seen.has(question.content))
                continue;
            seen.add(question.content);
            bucket.push(item);
            if (item.chapter)
                chapters.add(item.chapter);
        }
    };
    take(basic, basicCount, true);
    take(advanced, advancedCount, false);
    // 某一档不够时，用另一档补齐（同步练习页允许题量与预设略有出入，但尽量凑满）
    take(advanced, params.count, false);
    take(basic, params.count, true);
    const questions = [];
    for (const item of [...basic, ...advanced]) {
        const question = toPaperQuestion(item);
        if (!question)
            continue;
        questions.push({
            ...question,
            tier: item.difficulty === '基础' ? 'basic' : 'advanced',
            topic: topicOf(item),
        });
    }
    const scope = (params.scope ?? '').trim();
    const title = scope ? `${params.grade}${params.subject} · ${scope}（同步练习）` : `${params.grade}${params.subject} · 同步练习`;
    return {
        result: {
            title,
            questions,
            meta: {
                grade: params.grade,
                subject: params.subject,
                difficulty: params.difficulty,
                scope: scope || undefined,
            },
        },
        got: questions.length,
        missing: Math.max(0, params.count - questions.length),
        chapters: [...chapters],
    };
}
