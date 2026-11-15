import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineTool } from './tool-kit.js';
import { registerAdminPage, currentOrigin } from './admin-server.js';
import { PDF_PATH } from './admin-page.js';
import { appendItem } from './bank-store.js';
import { buildParamCard, cardCall, modeLabel } from './cards.js';
import { parseBrief } from './parse-brief.js';
import { QuizError } from './errors.js';
import { callModelText, resolveRoute } from './llm.js';
import { renderPaperPdf, renderSyncPdf, renderGraphPdf } from './pdf.js';
import { putPdf } from './pdf-store.js';
import { generateContent } from './pipeline.js';
import { buildKnowledgeTree, renderGraphText } from './modes/graph.js';
import { buildDrill, renderDrillText } from './modes/drill.js';
import { buildLesson, renderLessonText } from './modes/lesson.js';
import { renderDrillPdf, renderLessonPdf } from './pdf.js';
import { getBank } from './retrieve.js';
import { seedDir } from './retrieve.js';
export const name = 'dsh-exam-gen';
// 服务依赖决定加载顺序：tools 注册表 + llm 运行时都必须先就绪。
export const inject = ['tools', 'llm'];
const MODES = ['paper', 'drill', 'lesson', 'graph', 'sync'];
export function apply(ctx) {
    const llm = ctx.llm;
    const defaults = ctx.get('agentDefaultModel');
    ctx.tools.register(defineTool({
        name: 'generate_content',
        description: 'K12 理科出题，一步到位：试卷 / 专项突破 / 教学讲义 / 知识图谱 / 教材同步，并本地渲染可打印 PDF。' +
            '把用户原话整句放进 brief 即可，参数由插件解析（年级、科目、范围、题数、题型、难度都能认）。' +
            '模型走用户自己 DSH 里配置的路由，不需要 Key。',
        parameters: {
            type: 'object',
            properties: {
                brief: {
                    type: 'string',
                    description: '用户原话，例如「初二数学一元一次方程 8 道选择题」「写一份高一数学函数讲义」。',
                },
                quality: {
                    type: 'string',
                    enum: ['premium', 'turbo'],
                    description: 'premium（默认）模型按真题风格现出；turbo 只从题库抽，0 token。',
                },
            },
            required: ['brief'],
            additionalProperties: false,
        },
        output: {
            // 返回字段也瘦身：原来 7 个字段带描述约 200 token，现在只要 ok/text/pdfUrl/note。
            // text 就是成品（卷子正文），模型直接照着说一句就行，不用复述。
            schema: {
                type: 'object',
                properties: {
                    ok: { type: 'boolean', description: '成功与否。' },
                    text: { type: 'string', description: '成品正文。' },
                    pdfUrl: { type: 'string', description: 'PDF 下载地址，空串表示没导出。' },
                    note: { type: 'string', description: '一句话备注（模型、题数、是否命中题库）。' },
                },
                required: ['ok', 'text', 'pdfUrl', 'note'],
                additionalProperties: false,
            },
            render: (_args, value) => {
                const data = value;
                if (data.ok === false)
                    return [{ type: 'text', text: data.text || '出题失败，请重试' }];
                const link = data.pdfUrl
                    ? `\n\n---\n\n**PDF 已生成** → ${data.pdfUrl}\n\n点上面的链接下载打印。`
                    : '';
                const note = data.note ? `\n\n<sub>${data.note}</sub>` : '';
                return [{ type: 'text', text: (data.text ?? '') + link + note }];
            },
        },
        async execute(raw) {
            // 参数表只有 { brief, quality }：其余在本地解析，省下每轮约 650 token 的常驻 schema。
            const parsed = parseBrief(typeof raw.brief === 'string' ? raw.brief : '');
            const quality = raw.quality === 'turbo' ? 'turbo' : 'premium';
            // 局部对象沿用旧名字 args，下面各分支的逻辑不用改
            const args = {
                mode: parsed.mode,
                grade: parsed.grade,
                subject: parsed.subject,
                scope: parsed.scope,
                count: parsed.count,
                difficulty: parsed.difficulty,
                types: parsed.types === 'mixed' ? undefined : parsed.types,
                withAnswer: parsed.withAnswer,
                textbook: '人教版',
                lesson: undefined,
                ratio: 0.6,
                source: (quality === 'turbo' ? 'bank' : 'model'),
                export: 'pdf',
            };
            try {
                // ——— 教学讲义：把题库里一个知识点整理成能上课的讲义，0 token ———
                if ((args.mode ?? 'paper') === 'lesson') {
                    const index = await getBank();
                    const lesson = buildLesson(index, {
                        grade: args.grade ?? '初一',
                        subject: args.subject ?? '数学',
                        topic: args.scope ?? '',
                        count: args.count ?? 4,
                        difficulty: args.difficulty ?? '中等',
                        withAnswer: args.withAnswer !== false,
                    });
                    const text = renderLessonText(lesson);
                    let lessonPdf = null;
                    const lessonOrigin = currentOrigin();
                    if (args.export !== 'none' && lessonOrigin) {
                        const { buffer, pages } = await renderLessonPdf({
                            title: lesson.title,
                            topic: lesson.topic,
                            grade: args.grade ?? '初一',
                            sections: lesson.sections,
                            example: lesson.example,
                            exercises: lesson.exercises,
                        }, { withAnswer: args.withAnswer !== false });
                        const id = putPdf(`${lesson.title}.pdf`.replace(/[\\/:*?"<>|]/g, '-'), buffer);
                        lessonPdf = { url: `${lessonOrigin}${PDF_PATH}?id=${id}`, pages, bytes: buffer.length };
                    }
                    return {
                        ok: true,
                        text,
                        pdfUrl: lessonPdf?.url ?? '',
                        note: `教学讲义 · 题库整理 · 0 token · 练习 ${lesson.exercises.length} 道`,
                    };
                }
                // ——— 专项突破：题库按知识点聚一组递进题，0 token ———
                if ((args.mode ?? 'paper') === 'drill') {
                    const index = await getBank();
                    const drill = buildDrill(index, {
                        grade: args.grade ?? '初一',
                        subject: args.subject ?? '数学',
                        topic: args.scope ?? '',
                        count: args.count ?? 6,
                        difficulty: args.difficulty ?? '中等',
                        types: args.types ?? 'choice',
                        withAnswer: args.withAnswer !== false,
                    });
                    const text = renderDrillText(drill);
                    let drillPdf = null;
                    const drillOrigin = currentOrigin();
                    if (args.export !== 'none' && drillOrigin) {
                        const { buffer, pages } = await renderDrillPdf(drill, { withAnswer: args.withAnswer !== false });
                        const id = putPdf(`${drill.title}.pdf`.replace(/[\\/:*?"<>|]/g, '-'), buffer);
                        drillPdf = { url: `${drillOrigin}${PDF_PATH}?id=${id}`, pages, bytes: buffer.length };
                    }
                    return {
                        ok: true,
                        text,
                        pdfUrl: drillPdf?.url ?? '',
                        note: `专项突破 · 题库整理 · 0 token · 变式 ${drill.variations.length} 道`,
                    };
                }
                // ——— 知识图谱：纯本地聚合题库章节，0 token ———
                if ((args.mode ?? 'paper') === 'graph') {
                    const index = await getBank();
                    const tree = buildKnowledgeTree(index, {
                        subject: args.subject ?? '数学',
                        grade: args.grade,
                    });
                    const text = renderGraphText(tree);
                    let graphPdf = null;
                    const graphOrigin = currentOrigin();
                    if (args.export !== 'none' && graphOrigin) {
                        const { buffer, pages } = await renderGraphPdf(tree);
                        const id = putPdf(`${tree.title}.pdf`.replace(/[\\/:*?"<>|]/g, '-'), buffer);
                        graphPdf = { url: `${graphOrigin}${PDF_PATH}?id=${id}`, pages, bytes: buffer.length };
                    }
                    return {
                        ok: true,
                        text,
                        pdfUrl: graphPdf?.url ?? '',
                        note: `知识图谱 · 题库整理 · 0 token · 覆盖 ${tree.totalQuestions} 道题`,
                    };
                }
                const outcome = await generateContent(llm, defaults, {
                    mode: args.mode ?? 'paper',
                    params: {
                        grade: args.grade,
                        subject: args.subject,
                        scope: args.scope,
                        count: args.count,
                        difficulty: args.difficulty,
                        types: args.types,
                        withAnswer: args.withAnswer,
                        textbook: args.textbook,
                        lesson: args.lesson,
                        ratio: args.ratio,
                    },
                    source: args.source ?? 'model',
                });
                let pdf = null;
                const origin = currentOrigin();
                if (args.export !== 'none' && origin) {
                    pdf = await exportPaperPdf(outcome, args.withAnswer !== false, origin);
                }
                const body = renderPaperText(outcome.title, outcome.questions, args.withAnswer !== false, outcome.meta?.origin, outcome.meta?.model);
                const src = outcome.meta?.origin === 'bank'
                    ? '题库直出 · 0 token'
                    : outcome.meta?.origin === 'mixed'
                        ? '题库补题 + 模型'
                        : '模型生成';
                const who = outcome.meta?.model ? ` · ${outcome.meta.model}` : '';
                return {
                    ok: true,
                    text: body,
                    pdfUrl: pdf?.url ?? '',
                    note: `${outcome.title} · ${outcome.questions.length} 题 · ${src}${who} · ${outcome.meta?.elapsedMs ?? 0}ms`,
                };
            }
            catch (error) {
                // 所有错误包装成 QuizError：前端只渲染一句话，永不展示 raw stack。
                const message = error instanceof QuizError ? error.userMessage : '出题过程出错，请重试';
                return { ok: false, text: message, pdfUrl: '', note: '' };
            }
        },
    }));
    registerParamCard(ctx);
    registerCardPatch(ctx);
    // exam_bank_add 不再注册成工具：它常驻约 477 token，而加题这件事题库管理页
    // （/exam-bank 的「新增题目」「导入 JSON」）已经能做，没必要让每轮对话都为它付费。
    const adminPath = registerAdminPage(ctx, {
        dir: seedDir(),
        enabled: process.env.DSH_EXAM_ADMIN !== '0',
    });
    console.log(`[dsh-exam-gen] ready — tools=${describe(ctx)}` + (adminPath ? ` — 题库管理页 ${adminPath}` : ''));
    checkCardPatch();
}
/**
 * 检查 dsh-tool-cards 的提交路由补丁是否生效。
 *
 * 为什么要在运行时查：pnpm 10+ 默认拦掉依赖的 postinstall（报 ERR_PNPM_IGNORED_BUILDS），
 * 我们的 postinstall 补丁就不会执行，于是卡片一点提交就 405 —— 而用户完全不知道原因。
 * 这里检测一次并明确告诉他要跑哪条命令，比静默失败强。
 */
function checkCardPatch() {
    try {
        const require = createRequire(import.meta.url);
        let hostPath = '';
        try {
            // 先解析包主入口再拼 host.js —— 该包没有 exports 子路径映射，直接 resolve 子文件会失败
            hostPath = join(dirname(require.resolve('dsh-tool-cards')), 'host.js');
        }
        catch {
            return; // 没装卡片底座，属正常（卡片是可选功能）
        }
        if (!existsSync(hostPath))
            return;
        const source = readFileSync(hostPath, 'utf8');
        if (source.includes('[dsh-exam-gen patch]'))
            return;
        console.warn('[dsh-exam-gen] 参数卡片的提交路由还没修（pnpm 拦掉了 postinstall）。' +
            '卡片能显示但点提交会 405。修法二选一：\n' +
            '  · pnpm approve-builds 后重装本插件；\n' +
            `  · 直接跑 node "${hostPath.replace(/[\\/]node_modules[\\/].*$/, '')}/node_modules/dsh-exam-gen/scripts/patch-tool-cards.mjs"\n` +
            '出卷、导出 PDF、题库管理页不受影响。');
    }
    catch {
        // 检测本身失败不打扰用户
    }
}
function describe(ctx) {
    return ['generate_content', 'exam_card_spec']
        .filter((toolName) => ctx.tools.get(toolName) !== undefined)
        .join(',');
}
/**
 * 导出 PDF：本地 pdfkit 渲染 → 内存缓存 10 分钟 → 回一个可下载的绝对链接。
 *
 * 不写死盘的原因：卷子是一次性产物，落盘会攒垃圾、还要额外清理；
 * 只在内存活 10 分钟，用户下完就散，卸载插件也没残留。
 */
async function exportPaperPdf(outcome, withAnswer, origin) {
    const paper = { title: outcome.title, questions: outcome.questions };
    // 不同功能走不同版式：同步练习页 vs 高考卷式
    const { buffer, pages } = outcome.mode === 'sync'
        ? await renderSyncPdf(paper, {
            withAnswer,
            textbook: outcome.sync?.textbook,
            lesson: outcome.sync?.lesson,
        })
        : await renderPaperPdf(paper, { withAnswer });
    const safeTitle = outcome.title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 60) || '试卷';
    const id = putPdf(`${safeTitle}.pdf`, buffer);
    return { url: `${origin}${PDF_PATH}?id=${id}`, pages, bytes: buffer.length };
}
/**
 * 把结构化结果渲染成「能直接读/直接抄」的试卷文本。
 *
 * 为什么在这里渲染而不是让模型重述：工具结果本身就是成品，模型只需说一句「卷子在上面」。
 * 实测模型复述一遍要 1000+ output token，等于把这套流水线省下的 token 又花回去。
 */
function renderPaperText(title, questions, withAnswer, origin, model) {
    const total = questions.reduce((sum, question) => sum + (question.points ?? 0), 0);
    const src = origin === 'bank' ? '题库直出 · 0 token' : origin === 'mixed' ? '题库 + 模型补题' : '模型生成';
    // 把实际用的模型写出来：换模型对质量影响最大，用户要能一眼看到这次是谁出的题
    const who = model ? ` · ${model}` : '';
    const lines = [`## ${title}`, '', `共 ${questions.length} 题 · 满分 ${total} 分 · 来源：${src}${who}`, ''];
    questions.forEach((question, index) => {
        const typeName = question.type === 'choice' ? '选择题' : question.type === 'fill' ? '填空题' : '解答题';
        lines.push(`**${index + 1}.**（${typeName}，${question.points} 分）${question.content}`);
        if (question.options.length) {
            lines.push(question.options.map((option, i) => `${String.fromCharCode(65 + i)}. ${option}`).join('　　'));
        }
        lines.push('');
    });
    if (withAnswer) {
        lines.push('---', '', '### 参考答案', '');
        questions.forEach((question, index) => {
            lines.push(`**${index + 1}.** ${question.answerText || question.answer}`);
            if (question.analysis)
                lines.push(`> ${question.analysis}`);
        });
    }
    return lines.join('\n');
}
/**
 * 参数确认卡片（阶段3）。
 *
 * 关键取舍：卡片长什么样由 buildParamCard 写死，模型只输出一个几百字符的「骨架」，
 * 完整布局由 tools/post-execute 钩子在结果上补全（registerCardPatch）。
 *
 * 为什么不让模型直接输出完整载荷：只有 dsh-tool-cards 的 chat_ui 能签发提交凭证，
 * 所以卡片必须经模型调用；但 1800 字符的 JSON 让它逐字复述，实测 4/4 次都失败在
 * MALFORMED_RESPONSE（tool input is invalid JSON）。骨架方案把模型输出压到一百字符级。
 */
function registerParamCard(ctx) {
    ctx.tools.register(defineTool({
        name: 'exam_card_spec',
        description: '取「出题参数卡片」的调用骨架。把返回的 call 原样交给 chat_ui，不要改动。多用于用户没把参数说全时。',
        parameters: {
            type: 'object',
            properties: {
                brief: { type: 'string', description: '用户原话。' },
            },
            required: ['brief'],
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    ok: { type: 'boolean', description: '成功与否。' },
                    call: { type: 'string', description: 'chat_ui 参数 JSON。' },
                },
                required: ['ok', 'call'],
                additionalProperties: false,
            },
            render: (_args, value) => {
                const data = value;
                if (data.ok === false)
                    return [{ type: 'text', text: '参数卡片暂不可用，直接用默认参数调 generate_content。' }];
                return [{
                        type: 'text',
                        text: `把下面这一行原样作为 chat_ui 的参数（不要增删字段）：\n\n${data.call ?? ''}\n\nchat_ui 返回后一句话请用户在上面选参数并点按钮，不要复述参数。`,
                    }];
            },
        },
        async execute(raw) {
            const parsed = parseBrief(typeof raw.brief === 'string' ? raw.brief : '');
            const mode = parsed.mode;
            const preset = {
                grade: parsed.grade,
                subject: parsed.subject,
                scope: parsed.scope,
                count: parsed.count,
                difficulty: parsed.difficulty,
                types: parsed.types === 'mixed' ? undefined : parsed.types,
                withAnswer: parsed.withAnswer ? 'true' : 'false',
            };
            return { ok: true, call: cardCall(mode, preset) };
        },
    }));
}
/** 把用户已经说过的参数抽成卡片预设值（没说的保持缺省，让 buildParamCard 落默认）。 */
function readPreset(args) {
    const pick = (key) => {
        const value = args[key];
        return typeof value === 'string' && value.trim() === '' ? undefined : value;
    };
    const preset = {
        grade: pick('grade'),
        subject: pick('subject'),
        scope: pick('scope'),
        count: pick('count'),
        difficulty: pick('difficulty'),
        types: pick('types'),
    };
    const withAnswer = pick('withAnswer');
    if (typeof withAnswer === 'boolean')
        preset.withAnswer = withAnswer ? 'true' : 'false';
    return preset;
}
/**
 * 卡片补全钩子：模型只传 `{title, ui:{schemaVersion, tree:{id:'paper', type:'Card'}}}`，
 * 这里把 value.ui 换成 buildParamCard 的完整布局。
 *
 * 三道保险：①只处理 chat_ui；②只有 tree.id 命中五个 mode 才接管（模型自己画的其它卡片放行）；
 * ③只在值校验成功（ok:true）时替换 —— 卡片凭证已经签发，替换 ui 不影响 token 归属（token 只绑会话）。
 */
function registerCardPatch(ctx) {
    const bus = ctx;
    bus.on('tools/post-execute', async (exec, result, next) => {
        const decision = await next();
        if (decision?.kind !== 'accept' || decision.value !== undefined)
            return decision;
        if (exec?.name !== 'chat_ui')
            return decision;
        const args = (exec.arguments ?? {});
        const id = args.ui?.tree?.id;
        if (typeof id !== 'string' || !MODES.includes(id))
            return decision;
        const value = result?.value;
        if (value?.ok !== true)
            return decision;
        const preset = args.ui?.initialState ?? {};
        const spec = buildParamCard(id, preset);
        return { kind: 'accept', value: { ...value, ui: spec.ui } };
    });
}
