/**
 * 讲义走大模型：题库里那批是「诊断题」，题干短、没情境，直接搬进讲义会显得很干。
 * 所以讲义也交给模型写，插件只负责给骨架（概念 → 例题 → 练习 → 小结）和校验。
 */
const DIFF_HINT = {
    基础: '面向刚接触这个知识点的学生，计算不要绕，一步到位',
    中等: '按中考常规难度，允许一步转化或分类讨论',
    拔高: '可以有综合条件、需要两步以上推理，但不要超纲',
};
export function buildLessonPrompt(params) {
    const topic = params.topic?.trim() || '本学期核心章节';
    return [
        `你是${params.grade}${params.subject}老师，正在给一个学生写一份能直接上课用的讲义。`,
        `主题：${topic}。难度：${params.difficulty}（${DIFF_HINT[params.difficulty] ?? DIFF_HINT['中等']}）。`,
        '',
        '只输出一个 JSON 对象，不要任何解释文字、不要 Markdown 代码围栏。结构：',
        '{',
        '  "concept": ["先用两三句话说清这个知识点考什么、容易错在哪", "再给一条判断方法或口诀"],',
        '  "example": { "stem": "例题题干", "options": ["A. …","B. …"], "answer": "答案", "explanation": "分步骤讲清怎么想到的" },',
        '  "exercises": [ { "stem": "练习题干", "answer": "答案", "explanation": "一句话点出这题的关键" } ],',
        '  "summary": "一段话：这类题的通用打法是什么"',
        '}',
        '',
        '硬性要求：',
        '1. 例题必须是这个主题的典型题，题干写全条件，能带生活情境就带（购物、行程、测量、游戏规则都行）。',
        '2. 例题的 explanation 必须写出完整推理链：先干什么、为什么这么干、最后怎么验算。不要写"由题意得"这种跳步。',
        `3. exercises 出 ${Math.max(1, Math.min(params.count, 6))} 道，与例题同源但要有变化（换问法、换数据、加一个条件），不要只是改数字。`,
        '4. 所有数字、单位、符号写成纯文本：分数写 1/2 或 (a+b)/2，乘号写 ×，根号写 √，不要用 LaTeX（不要出现 $ 和 \\frac）。',
        '5. 答案必须自己算一遍，确认与题干条件一致；选择题的 answer 写选项字母。',
    ].join('\n');
}
export function validateLessonModel(raw) {
    if (!raw || typeof raw !== 'object')
        return { ok: false, error: '输出不是对象' };
    const obj = raw;
    const concept = Array.isArray(obj.concept) ? obj.concept.filter((x) => typeof x === 'string' && x.trim().length > 0) : [];
    if (concept.length === 0)
        return { ok: false, error: 'concept 至少要有一条' };
    const example = normalizeItem(obj.example);
    if (!example)
        return { ok: false, error: 'example 缺少题干或答案' };
    const list = Array.isArray(obj.exercises) ? obj.exercises : [];
    const exercises = list.map(normalizeItem).filter((x) => !!x);
    if (exercises.length === 0)
        return { ok: false, error: 'exercises 至少要有一道' };
    const summary = typeof obj.summary === 'string' && obj.summary.trim() ? obj.summary.trim() : '先判断问法，再选方法，最后代回验算。';
    return { ok: true, value: { concept, example, exercises, summary } };
}
function normalizeItem(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const obj = raw;
    const stem = typeof obj.stem === 'string' ? obj.stem.trim() : '';
    const answer = typeof obj.answer === 'string' ? obj.answer.trim() : '';
    if (stem.length < 6 || answer.length === 0)
        return null;
    const options = Array.isArray(obj.options)
        ? obj.options.filter((x) => typeof x === 'string' && x.trim().length > 0)
        : undefined;
    const explanation = typeof obj.explanation === 'string' ? obj.explanation.trim() : '';
    return {
        stem,
        ...(options && options.length >= 2 ? { options } : {}),
        answer,
        explanation,
    };
}
/** 把模型输出装配成 lesson.ts 认识的 LessonResult（PDF / 文本渲染都吃这个结构） */
export function lessonFromModel(value, params) {
    const topic = params.topic?.trim() || '本学期核心章节';
    return {
        title: `${params.grade}${params.subject} · ${topic}（讲义）`,
        topic,
        sections: [
            { type: 'concept', title: '这一讲在讲什么', lines: value.concept },
            { type: 'example', title: '例题精讲', lines: [] },
            { type: 'exercise', title: '自己动手', lines: [] },
            { type: 'summary', title: '小结', lines: [value.summary] },
        ],
        example: value.example,
        exercises: value.exercises,
        meta: { chapters: [topic], totalQuestions: value.exercises.length + 1 },
    };
}
