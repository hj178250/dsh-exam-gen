// 智能组卷（mode = 'paper'）：参数规范化 → 组装短 Prompt → 校验。
import { QuizError } from '../errors.js';
import { anchorsFor } from '../style-anchors.js';
export const QUESTION_TYPES = ['choice', 'fill', 'solve'];
const DEFAULT_SCOPE = {
    数学: '本学期核心章节',
    物理: '本学期核心章节',
    化学: '本学期核心章节',
    生物: '本学期核心章节',
};
/** 全部字段带默认值，无空白项：用户不调任何东西直接确定也能跑。 */
export function normalizePaperParams(raw) {
    const input = raw ?? {};
    const subject = text(input.subject) ?? '数学';
    const typeRaw = text(input.types) ?? text(input.type) ?? 'choice';
    return {
        grade: text(input.grade) ?? '初一',
        subject,
        scope: text(input.scope) ?? DEFAULT_SCOPE[subject] ?? '本学期核心章节',
        count: clampInt(input.count, 1, 50, 5),
        difficulty: difficulty(input.difficulty),
        types: QUESTION_TYPES.includes(typeRaw) ? typeRaw : 'choice',
        withAnswer: input.withAnswer === undefined ? true : input.withAnswer !== false,
    };
}
function text(value) {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
}
function clampInt(value, min, max, fallback) {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.min(max, Math.max(min, Math.trunc(parsed)));
}
function difficulty(value) {
    const raw = text(value);
    if (raw === '基础' || raw === '中等' || raw === '拔高')
        return raw;
    if (raw === 'easy')
        return '基础';
    if (raw === 'hard')
        return '拔高';
    return '中等';
}
const TYPE_LABEL = {
    choice: '单选题',
    fill: '填空题',
    solve: '解答题',
};
const SHAPE_HINT = `{"title":"卷名","questions":[{"type":"choice|fill|solve","content":"题干","options":["选项原文"],"answer":"A","points":5,"analysis":"解析"}]}`;
const LETTER_LIMIT = 26;
/**
 * 组装 Prompt。刻意做短：一个角色句 + 参数行 + 输出结构 + 硬规则 + 最多 2 条风格参考。
 * repair 非空时进入重试分支，把上次的错误原样回喂。
 */
export function buildPaperPrompt(params, hits, repair) {
    const lines = [];
    lines.push(`你是${params.grade}${params.subject}老师，出一套${TYPE_LABEL[params.types]}。只输出 JSON，不要解释、不要 Markdown 围栏。`);
    lines.push(`参数：范围=${params.scope}；数量=${params.count}；难度=${params.difficulty}；每题分值=${params.types === 'solve' ? 10 : 5}`);
    lines.push(`结构：${SHAPE_HINT}`);
    lines.push(`规则：type 只能是 choice/fill/solve；choice 的 options 至少 2 项、只能写选项原文不要加"A."这类前缀，answer 只填一个选项字母（A、B、C…，顺序对应 options）；fill 和 solve 的 options 给空数组、answer 写答案原文；answer 不能为空；points 是正整数；不要出现参数范围以外的知识点。`);
    lines.push(`问法要求（照卷面来，不要出成知识点判断题）：题干要像真卷——把条件写全（数字、单位、图形关系），能带情境就带情境（"某班""某商店""一条公路"）；禁止"下列说法正确的是哪一个""下列式子中是方程的是"这类脱离情境的辨析问法；禁止"是哪一个"这种生硬收尾，改用卷面问法（"求…的值""则…是（  ）""…的值是______"）。`);
    if (params.withAnswer)
        lines.push('答案与解析照常给出（answer、analysis 字段填满）。');
    else
        lines.push('answer 字段留空串，analysis 字段写空串（导出时由本地生成答案页）。');
    // 风格锚优先用插件内置的真题（固定、不随题库变化）；没有覆盖的学科才用检索结果
    const anchors = anchorsFor(params.subject, params.grade, 2);
    if (anchors.length > 0) {
        lines.push('卷面范例（学它的问法与信息密度，不要照抄题目、不要重复它的数字）：');
        anchors.forEach((anchor, index) => {
            lines.push(`${index + 1}) ${anchor.stem}`);
        });
    }
    else if (hits.length > 0) {
        lines.push('风格参考（只借难度与句式，不要照抄、不要改数字照搬）：');
        hits.forEach((hit, index) => {
            lines.push(`${index + 1}) ${hit.content}`);
        });
    }
    if (repair && repair.length > 0) {
        lines.push(`上次输出不合格：${repair.join('；')}。请修正后只输出 JSON。`);
    }
    return lines.join('\n');
}
/**
 * 选择题答案归一化（甲方 D3：answer 存字母，校验时反查选项）。
 * - 单字母 A–Z：按序号反查选项原文，越界即报错；
 * - 模型偶尔仍写选项原文：宽容地归一成字母，避免为这点小事重试；
 * - 两者都不是：报错，让重试通道带着具体原因再来一次。
 */
export function resolveChoiceAnswer(raw, options) {
    const trimmed = raw.trim();
    if (/^[A-Za-z]$/.test(trimmed)) {
        const index = trimmed.toUpperCase().charCodeAt(0) - 65;
        if (index >= options.length) {
            return { error: `的答案字母 ${trimmed.toUpperCase()} 超出选项数量（共 ${options.length} 项）` };
        }
        return { letter: trimmed.toUpperCase(), text: options[index] };
    }
    const matched = options.findIndex((option) => option.trim() === trimmed);
    if (matched >= 0)
        return { letter: String.fromCharCode(65 + matched), text: options[matched] };
    return { error: '的 answer 既不是选项字母也不在选项原文里' };
}
/** 委托书第七节的智能组卷校验规则，逐条落地。 */
export function validatePaper(raw, requireAnswer = true) {
    const errors = [];
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return { ok: false, errors: ['顶层必须是 JSON 对象'], value: null };
    }
    const root = raw;
    const title = text(root.title) ?? '未命名试卷';
    const list = Array.isArray(root.questions) ? root.questions : [];
    if (list.length === 0)
        errors.push('questions 为空');
    const questions = [];
    list.forEach((item, index) => {
        const label = `第${index + 1}题`;
        if (typeof item !== 'object' || item === null) {
            errors.push(`${label}不是对象`);
            return;
        }
        const row = item;
        const type = text(row.type);
        if (!type || !QUESTION_TYPES.includes(type)) {
            errors.push(`${label}的 type 不在 choice/fill/solve 之内`);
            return;
        }
        const content = text(row.content);
        if (!content) {
            errors.push(`${label}缺少题干`);
            return;
        }
        const options = Array.isArray(row.options) ? row.options.filter((opt) => typeof opt === 'string') : [];
        const answerRaw = text(row.answer);
        let answer = answerRaw ?? '';
        let answerText = answer;
        if (type === 'choice') {
            if (options.length < 2)
                errors.push(`${label}是选择题但选项少于 2 项`);
            else if (options.length > LETTER_LIMIT)
                errors.push(`${label}选项超过 26 项`);
            else if (!answerRaw) {
                if (requireAnswer)
                    errors.push(`${label}答案为空`);
            }
            else {
                const resolved = resolveChoiceAnswer(answerRaw, options);
                if (resolved.error !== undefined)
                    errors.push(`${label}${resolved.error}`);
                else {
                    answer = resolved.letter;
                    answerText = resolved.text;
                }
            }
        }
        else if (!answerRaw) {
            if (requireAnswer)
                errors.push(`${label}答案为空`);
        }
        const pointsRaw = typeof row.points === 'number' ? row.points : Number.parseInt(String(row.points ?? ''), 10);
        const points = Number.isFinite(pointsRaw) && pointsRaw > 0 ? Math.trunc(pointsRaw) : type === 'solve' ? 10 : 5;
        questions.push({
            type: type,
            content,
            options,
            answer,
            answerText,
            points,
            ...text(row.analysis) === undefined ? {} : { analysis: text(row.analysis) },
        });
    });
    if (errors.length > 0)
        return { ok: false, errors, value: null };
    return { ok: true, errors: [], value: { title, questions } };
}
/** 交付前的最后一道自检：数量是否达标（不作为重试理由，只记录）。 */
export function countGap(params, result) {
    if (result.questions.length === params.count)
        return null;
    return `模型给了 ${result.questions.length} 题，参数要求 ${params.count} 题`;
}
export function assertPaper(value) {
    const outcome = validatePaper(value);
    if (!outcome.ok || outcome.value === null) {
        throw new QuizError('INVALID_OUTPUT', '生成的题目没有通过校验', outcome.errors);
    }
    return outcome.value;
}
