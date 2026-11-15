// 教材同步（mode = 'sync'）：参数规范化。
//
// 这个功能和智能组卷共用题库与选题逻辑，区别只有三点：
//   1. 必须落在某一章/某一课时上，所以 scope 是硬要求（空则取默认章节）；
//   2. 题分成基础/提高两档，用 ratio 控制比例；
//   3. 卷头写教材版本与课时。
// 因为它要求「严格对应教材」，题库凑不够时不交给模型现编（模型出题容易跑出章节范围），
// 只把差额记进 meta.gap 由前端说明。
import { QuizError } from '../errors.js';
const TYPES = ['choice', 'fill', 'solve'];
const DIFFICULTIES = ['基础', '中等', '拔高'];
export function normalizeSyncParams(raw) {
    const input = raw ?? {};
    const grade = String(input.grade ?? '').trim();
    const subject = String(input.subject ?? '').trim();
    if (!grade)
        throw new QuizError('BAD_PARAMS', '请先说明年级（例如 初二）');
    if (!subject)
        throw new QuizError('BAD_PARAMS', '请先说明科目（例如 数学）');
    const scope = String(input.scope ?? '').trim() || '本学期核心章节';
    const count = clampInt(input.count, 1, 30, 6);
    const ratioRaw = Number(input.ratio ?? 0.6);
    const ratio = Number.isFinite(ratioRaw) ? Math.min(0.9, Math.max(0.2, ratioRaw)) : 0.6;
    const difficultyRaw = String(input.difficulty ?? '中等');
    const difficulty = DIFFICULTIES.includes(difficultyRaw)
        ? difficultyRaw
        : '中等';
    const typesRaw = String(input.types ?? 'choice');
    const types = TYPES.includes(typesRaw) ? typesRaw : 'choice';
    return {
        grade,
        subject,
        scope,
        count,
        difficulty,
        types,
        withAnswer: input.withAnswer !== false,
        textbook: String(input.textbook ?? '').trim() || '人教版',
        ratio,
    };
}
function clampInt(value, min, max, fallback) {
    const num = Math.round(Number(value));
    if (!Number.isFinite(num))
        return fallback;
    return Math.min(max, Math.max(min, num));
}
