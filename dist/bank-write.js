// 无感回写：把模型新编的题悄悄沉淀进本地题库，让库越用越大。
//
// 设计要点（甲方需求：用户察觉不到、不阻塞出题）：
// 1. 去重：按题干归一化（去空白/标点）判重，同一道题不会被重复沉淀。
// 2. 原子写：写临时文件再 rename，中途崩溃也不会写坏原库。
// 3. 备份：第一次写之前留 bank.json.bak，可回滚。
// 4. 不阻塞：整段逻辑 try/catch 全吞，失败只写日志，绝不影响本次出卷。
// 5. 低权重：回写的题 source='model-generated'，检索时不像 public-corpus 那样 +6，
//    避免把真题锚挤下去；但仍然可被命中，实现「越用越懂你」。
// 6. 写锁：模块内串行化，避免并发出卷同时写库互相覆盖。
import { readFile, writeFile, rename, copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
/** 归一化题干用于判重：去空白 + 常见标点。 */
function normKey(text) {
    return String(text || '')
        .replace(/\s+/g, '')
        .replace(/[，。；：、（）()【】\[\]{}"'“”‘’？?！!,，.。\-—_]/g, '')
        .slice(0, 120);
}
function stageOfGrade(grade) {
    return /高一|高二|高三|高中/.test(grade || '') ? 'senior' : /初一|初二|初三|初中/.test(grade || '') ? 'junior' : '';
}
function typeOf(raw) {
    const t = String(raw || '');
    if (/选择|choice|单选/.test(t))
        return 'choice';
    if (/多选|multi/.test(t))
        return 'multi';
    if (/填空|fill/.test(t))
        return 'fill';
    if (/解答|计算|证明|solve/.test(t))
        return 'solve';
    return 'choice';
}
function difficultyOf(raw) {
    if (/拔高|压轴|难/.test(raw || ''))
        return '拔高';
    if (/基础|简单|容易|入门/.test(raw || ''))
        return '基础';
    return '中档';
}
let writeChain = Promise.resolve();
/** 串行执行写库任务，避免并发覆盖。 */
function serialize(task) {
    const result = writeChain.then(task, task);
    writeChain = result.catch(() => { });
    return result;
}
/**
 * 把模型新编的题沉淀进「持久题库」（<DSH_HOME>/exam-gen-bank/bank.json）。
 * 首次写入时自动从随包原始库 seed 一份过去——之后 DSH 更新覆盖包目录也动不了这份。
 * 永远不抛异常——失败返回 added:0。
 * @param seedFile 随包原始 bank.json（首次 seed 的数据源）
 * @param targetFile 持久 bank.json（真正写入目标）
 */
export function absorbGeneratedQuestions(seedFile, targetFile, ctx, questions) {
    return serialize(async () => {
        const empty = { added: 0, skipped: questions.length, total: 0, file: targetFile };
        try {
            if (!questions.length)
                return empty;
            // 首次：持久库不存在 → 从随包原始库 seed 一份（保留全部原始字段）。
            if (!existsSync(targetFile)) {
                if (!seedFile || !existsSync(seedFile))
                    return empty;
                await mkdir(dirname(targetFile), { recursive: true });
                await copyFile(seedFile, targetFile);
            }
            const bankFile = targetFile;
            const raw = JSON.parse(await readFile(bankFile, 'utf8'));
            const isArray = Array.isArray(raw);
            const items = isArray ? raw : Array.isArray(raw.items) ? raw.items : [];
            if (!items.length)
                return empty;
            const seen = new Set();
            for (const q of items)
                seen.add(normKey(q.content));
            const now = Date.now();
            let added = 0;
            let skipped = 0;
            for (let i = 0; i < questions.length; i += 1) {
                const q = questions[i];
                if (!q || !q.content || !String(q.content).trim()) {
                    skipped += 1;
                    continue;
                }
                const key = normKey(q.content);
                if (!key || seen.has(key)) {
                    skipped += 1;
                    continue;
                }
                seen.add(key);
                const id = `gen-${now.toString(36)}-${i}-${createHash('md5').update(key).digest('hex').slice(0, 6)}`;
                const item = {
                    id,
                    stage: stageOfGrade(ctx.grade),
                    grade: ctx.grade,
                    subject: ctx.subject,
                    chapter: ctx.chapter || ctx.scope || '',
                    topic: q.topic || '',
                    difficulty: difficultyOf(ctx.difficulty),
                    type: typeOf(q.type),
                    content: q.content,
                    options: Array.isArray(q.options) ? q.options : [],
                    answer: q.answer,
                    answerText: q.answerText || q.answer,
                    explanation: q.explanation || q.analysis || '',
                    hasFigure: false,
                    source: 'model-generated',
                };
                items.push(item);
                added += 1;
            }
            if (added === 0)
                return { added: 0, skipped, total: items.length, file: bankFile };
            // 首次写前备份（保留原始干净库）
            const bak = `${bankFile}.bak`;
            try {
                if (!existsSync(bak))
                    await copyFile(bankFile, bak);
            }
            catch { }
            const next = isArray ? items : { ...raw, items };
            const tmp = `${bankFile}.tmp-${process.pid}-${now}`;
            await writeFile(tmp, JSON.stringify(next), 'utf8');
            await rename(tmp, bankFile);
            return { added, skipped, total: items.length, file: bankFile };
        }
        catch (error) {
            // 静默：绝不因为回写失败影响出题。只在 stderr 留一行，不进对话。
            try {
                process.stderr.write(`[exam-gen] bank absorb skipped: ${error instanceof Error ? error.message : String(error)}\n`);
            }
            catch { }
            return empty;
        }
    });
}
/** 随包原始题库文件路径（seed 数据源）。 */
export function bankFilePath(seedDir) {
    const bank = join(seedDir, 'bank.json');
    return existsSync(bank) ? bank : join(seedDir, 'quiz-seed.json');
}
/** 持久题库文件路径（回写 / 用户改库的目标）。 */
export function persistentBankPath(dshHome) {
    return join(dshHome, 'exam-gen-bank', 'bank.json');
}
export { dirname };
