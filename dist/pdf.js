/**
 * 本地 PDF 渲染：题库直出的结构化数据 → 高考卷式 A4。
 *
 * 三条硬约束（来自委托书和甲方口述）：
 *   1. 零模型调用 —— 只吃 PaperResult，不碰 ctx.llm；
 *   2. 版式固定 —— 字体/字号/页边距/分栏都在这里写死，用户改不了；
 *   3. 数学要像卷子 —— 分数画成上下结构（不是 a/b），上标用真上标字符。
 *
 * 排版风格参照高考数学卷：卷头居中标题 + 考试信息 + 注意事项框 + 考生信息栏，
 * 题目按「选择题 / 填空题 / 解答题」分节，选题 2~4 列对齐，答案单独起页。
 */
import PDFDocument from 'pdfkit';
import { splitMath, normalizeExponents, normalizeChem, parseMathRuns } from './math-text.js';
import { stripLatex } from './latex.js';
/** 按学科选上标/下标处理：化学走 normalizeChem（化学式、离子电荷），其余走数学上标。 */
function normalizeText(text, subject) {
    // 兜底剥 LaTeX：题库加载时已 stripLatex，但直接调用 renderPaperPdf 的路径（脚本/外部数据）
    // 可能仍带字面 \sqrt{3}/\frac{1}{2}，先剥一遍再走上下标/化学式归一。
    return subject === '化学' ? normalizeChem(stripLatex(text)) : normalizeExponents(stripLatex(text));
}
/**
 * 把上标/下标标记解析成 run，交给 drawRuns 用小字号 + Y 偏移真实排版。
 * 宋体缺 Unicode 上下标字形，直接画字符会空白——必须走这条路。
 * 化学卷先过 normalizeChem（把 Ca2+ 变成 Ca²⁺ 这类标记），数学卷保持原样。
 */
function mathRuns(text, subject) {
    return parseMathRuns(normalizeText(text, subject));
}
/**
 * 逐 run 画一行文字：base 用正文字号，sup/sub 用 ~62% 字号 + 上/下偏移。
 * 返回这段文本占用的宽度。所有上下标都用普通 ASCII 数字/字母，绕开字体缺字形的问题。
 */
function drawRuns(doc, runs, x, y, size) {
    const SUP_RATIO = 0.62;
    const SUP_LIFT = 0.42; // 上标相对基线上移（字号倍数）
    const SUB_DROP = 0.20; // 下标相对基线下移（字号倍数）
    let cursor = x;
    for (const run of runs) {
        if (run.kind === 'base') {
            // 整段画，减少 drawText 次数；外层 flowMath 已保证不超宽。
            doc.font('song').fontSize(size).fillColor('#111');
            const cw = doc.widthOfString(run.text);
            doc.text(run.text, cursor, y, { lineBreak: false });
            cursor += cw;
        }
        else {
            const ss = size * SUP_RATIO;
            doc.font('song').fontSize(ss).fillColor('#111');
            // 上标上移、下标下移；用普通字符，不依赖字体上下标字形
            const dy = run.kind === 'sup' ? -size * SUP_LIFT : size * SUB_DROP;
            const text = run.text;
            const cw = doc.widthOfString(text);
            doc.text(text, cursor, y + dy, { lineBreak: false });
            cursor += cw;
        }
    }
    return cursor - x;
}
// ── 版式常量（锁死，不对外暴露） ────────────────────────────────
const A4 = { width: 595.28, height: 841.89 };
const MARGIN = { top: 52, bottom: 58, left: 56, right: 56 };
const CONTENT_WIDTH = A4.width - MARGIN.left - MARGIN.right;
/**
 * 卷面版式固定 spec（对标 GitHub 真卷模板固化，防止每次改版凭感觉调）：
 *   - gaokao_exam（shaodongtang/gaokao_exam，LaTeX 91★）：A3 双栏横排 + 装订线是印刷格式，
 *     其硬参数被吸收成 A4 单栏打印版式——绝密★启用前、黑体大题标题、解答题分值右对齐、页脚双计数。
 *   - ezexam（gbchu/ezexam，Typst 47★）：选项 label-offset/悬挂缩进、fillin 空线 3em、
 *     题号悬挂缩进（hanging-indent）、公式过高题号错位解法（题号固定 22pt 宽，正文独立流排）。
 * 所有值一次性写死；改版式只动这里，不动下面任何绘制函数。
 */
const PAPER_LAYOUT = {
    // 卷头
    headerTitleSize: 19, // 主标题黑体 19pt（对标真卷 zihao{3}≈16pt 放大适配 A4 单栏）
    headerInfoSize: 9.5, // 考试时间/满分行
    headerLabelGap: '　　', // 卷面规格与考试信息之间的全角空隙
    noticeBoxHeight: 62, // 注意事项框高度
    noticeLineGap: 2.5,
    // 绝密★启用前（gaokao_exam \juemi：黑体小四）
    secretMark: '绝密★启用前',
    secretMarkSize: 12,
    // 大题标题（gaokao_exam ctexset：黑体五号≈10.5pt，我们放大到 12 保证层级感）
    sectionTitleSize: 12,
    // 题干
    questionLabelWidth: 22, // 题号列宽（悬挂缩进：正文从 22pt 起，回行对齐）
    optionLabelOffset: 15, // 选项字母列宽（对标 tasks label-offset 0.4em≈5pt 放大适配）
    optionLabelGap: 26, // 选项槽位补偿（字母 15 + 间隙）
    fillBlankWidth: 210, // 填空题作答横线长度（对标 ezexam fillin len 27.5pt 放大到适合 A4 单栏）
    // 解答题：得分虚线 + 分值右对齐（gaokao_exam \defen dash pattern）
    scoreDashPattern: [1, 2.5],
    scoreDashGap: 4,
    scoreLabelOffset: 34, // 分值文字与虚线末端的距离
    // 页脚（gaokao_exam fancyfoot 双计数：第X页 / 共Y页）
    footerSize: 8,
    footerTitleWidthRatio: 0.5, // 卷名占左半，页码占右半
    // 密封线
    sealLineText: '———————————————————— 密 封 线 ————————————————————',
};
const BODY_SIZE = 10.5;
const BODY_LINE = 17;
const SMALL_SIZE = 9;
// Windows 自带字体；中文卷子用宋体正文 + 黑体标题最接近印刷体
const FONTS = {
    song: 'C:/Windows/Fonts/simsun.ttc',
    hei: 'C:/Windows/Fonts/simhei.ttf',
    kai: 'C:/Windows/Fonts/simkai.ttf',
};
const SECTION_ORDER = [
    { type: 'choice', title: '选择题' },
    { type: 'multi', title: '多项选择题' },
    { type: 'fill', title: '填空题' },
    { type: 'solve', title: '解答题' },
];
/** 渲染一份试卷到 PDF Buffer，同时回传页数（前端要显示「共 N 页」）。 */
export function renderPaperPdf(paper, options) {
    const doc = new PDFDocument({
        size: 'A4',
        margins: MARGIN,
        bufferPages: true,
        info: { Title: paper.title, Creator: 'dsh-exam-gen' },
    });
    registerFonts(doc);
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    let pageCount = 0;
    const done = new Promise((resolve, reject) => {
        // bufferedPageRange() 必须在 doc.end() 之前读：结束写入后 pdfkit 会清掉缓冲区
        doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), pages: pageCount }));
        doc.on('error', reject);
    });
    const totalPoints = options.totalPoints ?? paper.meta?.totalPoints ?? sumPoints(paper);
    drawHeader(doc, paper, totalPoints, options.examMinutes ?? paper.meta?.minutes ?? estimateMinutes(paper));
    drawQuestions(doc, paper);
    if (options.withAnswer) {
        doc.addPage();
        drawAnswerPage(doc, paper);
    }
    stampFooters(doc, paper.title);
    pageCount = doc.bufferedPageRange().count;
    doc.end();
    return done;
}
function registerFonts(doc) {
    doc.registerFont('song', FONTS.song, 'SimSun');
    doc.registerFont('hei', FONTS.hei);
    doc.registerFont('kai', FONTS.kai);
}
function sumPoints(paper) {
    return paper.questions.reduce((sum, q) => sum + (q.points || 0), 0);
}
function estimateMinutes(paper) {
    // 先按每题 3 分钟粗估，再夹到 45~120 分钟的常见区间
    return Math.min(120, Math.max(45, Math.round(paper.questions.length * 3)));
}
function drawHeader(doc, paper, totalPoints, minutes) {
    const centerX = A4.width / 2;
    // 绝密★启用前（真卷卷头第一行，gaokao_exam \juemi 黑体小四左对齐）
    doc.font('hei').fontSize(PAPER_LAYOUT.secretMarkSize).fillColor('#111');
    doc.text(PAPER_LAYOUT.secretMark, MARGIN.left, MARGIN.top - 4, { width: CONTENT_WIDTH, lineBreak: false });
    doc.y = MARGIN.top + 12;
    doc.font('hei').fontSize(PAPER_LAYOUT.headerTitleSize).fillColor('#111');
    doc.text(paper.title, MARGIN.left, doc.y, { width: CONTENT_WIDTH, align: 'center' });
    doc.moveDown(0.35);
    doc.font('song').fontSize(PAPER_LAYOUT.headerInfoSize).fillColor('#333');
    const difficulty = paper.meta?.difficulty ? `　　难度：${paper.meta.difficulty}` : '';
    const label = paper.meta?.label ? `${paper.meta.label}${PAPER_LAYOUT.headerLabelGap}` : '';
    doc.text(`${label}考试时间：${minutes} 分钟　　满分：${totalPoints} 分${difficulty}`, { width: CONTENT_WIDTH, align: 'center' });
    doc.moveDown(0.7);
    // 注意事项框
    const boxTop = doc.y;
    const boxHeight = PAPER_LAYOUT.noticeBoxHeight;
    doc.save();
    doc.lineWidth(0.8).strokeColor('#999');
    doc.rect(MARGIN.left, boxTop, CONTENT_WIDTH, boxHeight).stroke();
    doc.restore();
    doc.font('hei').fontSize(9).fillColor('#111');
    doc.text('注意事项', MARGIN.left + 10, boxTop + 7, { width: 60 });
    doc.font('song').fontSize(9).fillColor('#222');
    doc.text([
        '1．答题前请将姓名、班级、学号填写在密封线内。',
        '2．选择题、填空题答案写在答题处；解答题写出必要的文字说明、演算步骤。',
        '3．考试结束后，将本试卷和答题卡一并交回。',
    ].join('\n'), MARGIN.left + 68, boxTop + 6, { width: CONTENT_WIDTH - 80, lineGap: PAPER_LAYOUT.noticeLineGap });
    doc.y = boxTop + boxHeight + 10;
    // 考生信息栏 + 密封线
    const infoY = doc.y;
    doc.font('song').fontSize(BODY_SIZE).fillColor('#111');
    doc.text('姓名：____________　　班级：____________　　学号：____________', MARGIN.left, infoY, {
        width: CONTENT_WIDTH,
    });
    doc.moveDown(0.6);
    doc.font('kai').fontSize(SMALL_SIZE).fillColor('#666');
    doc.text(PAPER_LAYOUT.sealLineText, MARGIN.left, doc.y, {
        width: CONTENT_WIDTH,
        align: 'center',
    });
    doc.moveDown(0.9);
    doc.fillColor('#111');
    void centerX;
}
function drawQuestions(doc, paper) {
    let index = 0;
    // 题号跨板块连续（真高考卷就是 1~19 连排，不会每个板块又从 1 开始）
    let serial = 0;
    const subject = paper.meta?.subject;
    for (const section of SECTION_ORDER) {
        const group = paper.questions.filter((q) => normalizeType(q.type) === section.type);
        if (group.length === 0)
            continue;
        const points = group.reduce((sum, q) => sum + (q.points || 0), 0);
        ensureSpace(doc, 40);
        doc.moveDown(0.5);
        doc.font('hei').fontSize(12).fillColor('#111');
        doc.text(`${chineseNumber(++index)}、${section.title}（共 ${group.length} 题，${points} 分）`, MARGIN.left, doc.y, {
            width: CONTENT_WIDTH,
        });
        doc.moveDown(0.35);
        group.forEach((question, i) => {
            const isLast = i === group.length - 1;
            serial += 1;
            drawQuestion(doc, serial, question, isLast, subject);
        });
    }
}
function drawQuestion(doc, number, question, isLast, subject) {
    const labelWidth = PAPER_LAYOUT.questionLabelWidth;
    ensureSpace(doc, 46);
    const startY = doc.y;
    doc.font('song').fontSize(BODY_SIZE).fillColor('#111');
    doc.text(`${number}.`, MARGIN.left, startY, { width: labelWidth, lineBreak: false });
    // 解答题的小问（(1)…；(2)…）常被模型写在同一行，真卷里是一行一问。
    // 在「；」「。」后面紧跟小问编号处强制换行，模型没换行也能排成一行一问。
    const content = normalizeType(question.type) === 'solve'
        ? splitSubQuestions(normalizeText(question.content, subject))
        : normalizeText(question.content, subject);
    let cursorY = flowMath(doc, content, MARGIN.left + labelWidth, startY, CONTENT_WIDTH - labelWidth, {
        size: BODY_SIZE,
    }, subject);
    const options = question.options ?? [];
    if (options.length > 0) {
        cursorY += 3;
        cursorY = drawOptions(doc, options, cursorY, subject);
    }
    else if (normalizeType(question.type) === 'solve') {
        // 得分虚线 + 分值右对齐（gaokao_exam \defen：dash on 1pt off 2.5pt + 「(X 分)」）
        const dashEnd = MARGIN.left + CONTENT_WIDTH;
        const scoreY = cursorY + PAPER_LAYOUT.scoreDashGap;
        doc.save();
        doc.lineWidth(0.7).strokeColor('#999');
        doc.dash(PAPER_LAYOUT.scoreDashPattern);
        doc.moveTo(MARGIN.left + labelWidth, scoreY);
        doc.lineTo(dashEnd, scoreY);
        doc.stroke();
        doc.undash();
        doc.restore();
        doc.font('song').fontSize(SMALL_SIZE).fillColor('#888');
        doc.text(`（${question.points || 15} 分）`, dashEnd + 2, scoreY - 6, { width: 60, lineBreak: false });
        // 解答题留作答空间（按分值给行数，卷面更像样）
        const lines = Math.max(4, Math.min(12, Math.round((question.points || 10) / 2.5)));
        cursorY = scoreY + lines * BODY_LINE * 0.9;
    }
    else {
        // 填空题：题干本身不带空位时，在题干下方单独一行画作答横线（卷面常见做法）
        if (!/[＿_]{2,}/.test(question.content)) {
            const lineY = cursorY + 7;
            doc.save();
            doc.font('song').fontSize(SMALL_SIZE).fillColor('#666');
            doc.text('答：', MARGIN.left + labelWidth, cursorY - 1, { width: 24, lineBreak: false });
            doc.lineWidth(0.7).strokeColor('#333');
            doc.moveTo(MARGIN.left + labelWidth + 26, lineY);
            doc.lineTo(MARGIN.left + labelWidth + PAPER_LAYOUT.fillBlankWidth, lineY);
            doc.stroke();
            doc.restore();
            cursorY += 22;
        }
        else {
            cursorY += 8;
        }
    }
    doc.y = cursorY + (isLast ? 6 : 8);
}
/**
 * 把小问编号前的分号/句号转成换行：
 * `…短轴长为2。(1) 求方程；(2) 过点 P…` → `…短轴长为2。\n(1) 求方程；\n(2) 过点 P…`
 *
 * 只认「；」或「。」后面紧跟 `(1)`、`(2)`、`（3）` 这种「括号+纯数字」的小问头，
 * 所以不会误伤数学里的 `P(0,2)`（括号里是 `0,2` 带逗号）、`f(x)=(x-1)(x+1)`（括号里是字母）。
 */
function splitSubQuestions(text) {
    return text.replace(/([；。])\s*(?=[（(]\d{1,2}[)）])/g, '$1\n');
}
function drawOptions(doc, options, top, subject) {
    const letters = 'ABCDEFGH';
    const indent = 22;
    const usable = CONTENT_WIDTH - indent;
    // 列数按「最长选项的实际渲染宽度」算，能塞几列就塞几列（2~4），避免长选项被硬折行
    doc.font('song').fontSize(BODY_SIZE);
    const widest = Math.max(...options.map((option) => doc.widthOfString(normalizeText(option, subject))), 1);
    const slot = widest + PAPER_LAYOUT.optionLabelGap;
    const columns = Math.max(2, Math.min(4, Math.floor(usable / slot)));
    const columnWidth = usable / columns;
    const rowHeight = BODY_LINE + 2;
    let y = top;
    for (let i = 0; i < options.length; i += columns) {
        const row = options.slice(i, i + columns);
        row.forEach((option, j) => {
            const letter = letters[i + j] ?? '?';
            const x = MARGIN.left + indent + j * columnWidth;
            doc.font('song').fontSize(BODY_SIZE).fillColor('#111');
            doc.text(`${letter}.`, x, y, { width: PAPER_LAYOUT.optionLabelOffset, lineBreak: false });
            flowMath(doc, normalizeText(option, subject), x + PAPER_LAYOUT.optionLabelOffset, y, columnWidth - 18, { size: BODY_SIZE }, subject);
        });
        y += rowHeight;
    }
    return y;
}
function drawAnswerPage(doc, paper) {
    doc.font('hei').fontSize(15).fillColor('#111');
    doc.text('参考答案与解析', MARGIN.left, MARGIN.top, { width: CONTENT_WIDTH, align: 'center' });
    doc.moveDown(0.8);
    // 选择题速查表（单选 + 多选都进表）
    const choices = paper.questions
        .map((q, i) => ({ index: i + 1, q }))
        .filter((row) => {
        const type = normalizeType(row.q.type);
        return (type === 'choice' || type === 'multi') && row.q.answer;
    });
    if (choices.length >= 4) {
        drawAnswerTable(doc, choices);
        doc.moveDown(0.8);
    }
    paper.questions.forEach((question, i) => {
        ensureSpace(doc, 40);
        const y = doc.y;
        doc.font('hei').fontSize(BODY_SIZE).fillColor('#111');
        doc.text(`${i + 1}．`, MARGIN.left, y, { width: 22, lineBreak: false });
        const parts = [];
        if (question.answer)
            parts.push(`答案：${normalizeText(String(question.answerText || question.answer), paper.meta?.subject)}`);
        if (question.analysis)
            parts.push(`解析：${normalizeText(question.analysis, paper.meta?.subject)}`);
        doc.font('song').fontSize(BODY_SIZE - 0.5).fillColor('#111');
        const endY = flowMath(doc, parts.join('　'), MARGIN.left + 22, y, CONTENT_WIDTH - 22, { size: BODY_SIZE - 0.5 }, paper.meta?.subject);
        doc.y = endY + 5;
    });
}
function drawAnswerTable(doc, rows) {
    const perRow = Math.min(6, rows.length);
    const cellWidth = CONTENT_WIDTH / perRow;
    let y = doc.y;
    for (let start = 0; start < rows.length; start += perRow) {
        const slice = rows.slice(start, start + perRow);
        doc.font('hei').fontSize(SMALL_SIZE).fillColor('#111');
        slice.forEach((row, j) => {
            doc.text(`第 ${row.index} 题`, MARGIN.left + j * cellWidth, y, { width: cellWidth, align: 'center' });
        });
        doc.font('song').fontSize(SMALL_SIZE).fillColor('#111');
        slice.forEach((row, j) => {
            doc.text(String(row.q.answer ?? '—'), MARGIN.left + j * cellWidth, y + 14, { width: cellWidth, align: 'center' });
        });
        y += 32;
    }
    doc.y = y;
}
/**
 * 行内数学流式排版：逐词摆放，遇到分数就画成上/横线/下三段。
 * 返回排版结束后的 y（下一行起点）。
 */
function flowMath(doc, text, startX, startY, maxWidth, style, subject) {
    const size = style.size;
    const small = size * 0.86;
    // 普通行高照旧；含分式的行加高，给「分子在上、分母在下」留出上下空间。
    const normalLine = size * 1.66;
    const fracLine = small * 2 + 12;
    let x = startX;
    let y = startY;
    const rightEdge = startX + maxWidth;
    // 先按视觉行缓冲 token，再一次性画出：这样才知道这一行有没有分式、该用多高的行高。
    // 旧实现是「边排边画」，分式的分子画到了上一行里，前后两个分式/两行文字就叠在一起。
    let line = [];
    const flush = () => {
        if (line.length === 0)
            return;
        const hasFrac = line.some((entry) => entry.token.kind === 'frac');
        for (const entry of line)
            drawToken(doc, entry.token, entry.x, y, size, hasFrac, subject);
        y += hasFrac ? fracLine : normalLine;
        line = [];
    };
    const words = segment(text);
    for (const word of words) {
        if (word === '\n') {
            flush();
            x = startX;
            continue;
        }
        const tokens = splitMath(word);
        for (const token of tokens) {
            const width = tokenWidth(doc, token, size);
            if (x + width > rightEdge && x > startX) {
                flush();
                x = startX;
            }
            line.push({ token, x });
            x += width;
        }
    }
    flush();
    return y;
}
function segment(text) {
    const out = [];
    let buffer = '';
    for (const ch of text) {
        if (ch === '\n') {
            if (buffer)
                out.push(buffer);
            buffer = '';
            out.push('\n');
            continue;
        }
        buffer += ch;
        // 中日韩标点/空格后可以断行
        if (' 　，。；：、？！（）'.includes(ch)) {
            out.push(buffer);
            buffer = '';
        }
    }
    if (buffer)
        out.push(buffer);
    return out;
}
function tokenWidth(doc, token, size) {
    if (token.kind === 'text') {
        doc.font('song').fontSize(size);
        return doc.widthOfString(token.text);
    }
    if (token.kind === 'sqrt') {
        doc.font('song').fontSize(size * 0.86);
        const radix = doc.widthOfString('√') * 0.72;
        return radix + runsWidth(doc, parseMathRuns(token.text), size * 0.86) + 2;
    }
    doc.font('song').fontSize(size * 0.86);
    const num = doc.widthOfString(token.num);
    const den = doc.widthOfString(token.den);
    return Math.max(num, den) + 4;
}
/** 量一组 MathRun 的总宽（与 drawRuns 同一字号规则，供根号/预量用）。 */
function runsWidth(doc, runs, size) {
    const SUP_RATIO = 0.62;
    let w = 0;
    for (const run of runs) {
        doc.font('song').fontSize(run.kind === 'base' ? size : size * SUP_RATIO);
        w += doc.widthOfString(run.text);
    }
    return w;
}
function drawToken(doc, token, x, y, size, hasFrac = true, subject) {
    if (token.kind === 'text') {
        // 上下标不能靠字体字形（宋体只剩 ¹²³），要拆成 run 用小字号+Y偏移真排版。
        drawRuns(doc, parseMathRuns(token.text), x, y, size);
        return;
    }
    // 分数：分子在上、分母在下，基线对齐同行的普通文字。
    const small = size * 0.86;
    doc.font('song').fontSize(small).fillColor('#111');
    // 根号：宋体的 √ 字形只有小钩、没有盖住被开方数的上划线（vinculum），
    // 直接印「√3」看起来就是横杠被擦掉了。这里手画：√ 字形 + 顶横线延伸盖住被开方数。
    if (token.kind === 'sqrt') {
        const inner = token.text;
        doc.font('song').fontSize(small).fillColor('#111');
        const innerRuns = parseMathRuns(normalizeText(inner, subject));
        // 先量内层宽度（临时画不可取，用 drawRuns 的宽度语义重算）
        const innerWidth = runsWidth(doc, innerRuns, small);
        const radixWidth = doc.widthOfString('√');
        const width = radixWidth * 0.72 + innerWidth + 2;
        // 根号钩子略上提，让它看起来勾住内容；顶横线从钩子延伸到内容末端。
        const radY = y - size * 0.18;
        doc.text('√', x, radY, { lineBreak: false });
        const overlineY = radY - small * 0.62;
        doc.save();
        doc.lineWidth(0.7).strokeColor('#111');
        doc.moveTo(x + radixWidth * 0.5, overlineY);
        doc.lineTo(x + width, overlineY);
        doc.stroke();
        doc.restore();
        drawRuns(doc, innerRuns, x + radixWidth * 0.72, y, small);
        return;
    }
    const numWidth = doc.widthOfString(token.num);
    const denWidth = doc.widthOfString(token.den);
    const width = Math.max(numWidth, denWidth) + 4;
    // 同行文字基线在 y 的顶端附近（pdfkit text() 的 y 是「文本行盒顶部」）；
    // 分数线放在普通文字纵向中部，分子在线上、分母在线下。
    const barY = y + (hasFrac ? size * 0.7 : size * 0.62);
    doc.text(token.num, x + (width - numWidth) / 2, barY - small - 1.2, { lineBreak: false });
    doc.text(token.den, x + (width - denWidth) / 2, barY + 1.6, { lineBreak: false });
    doc.save();
    doc.lineWidth(0.6).strokeColor('#111');
    doc.moveTo(x + 1.2, barY);
    doc.lineTo(x + width - 1.2, barY);
    doc.stroke();
    doc.restore();
}
function ensureSpace(doc, needed) {
    if (doc.y + needed > A4.height - MARGIN.bottom)
        doc.addPage();
}
function stampFooters(doc, title) {
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
        doc.switchToPage(range.start + i);
        const y = A4.height - MARGIN.bottom + 22;
        // 页脚落在下边距里，必须临时把 bottom margin 归零，
        // 否则 pdfkit 判定「y 超出内容区」会自动 addPage，凭空多出空白页
        const savedBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.font('song').fontSize(PAPER_LAYOUT.footerSize).fillColor('#666');
        doc.text(title, MARGIN.left, y, { width: CONTENT_WIDTH * PAPER_LAYOUT.footerTitleWidthRatio, align: 'left', lineBreak: false });
        doc.text(`第 ${i + 1} 页 / 共 ${range.count} 页`, MARGIN.left + CONTENT_WIDTH * PAPER_LAYOUT.footerTitleWidthRatio, y, {
            width: CONTENT_WIDTH * (1 - PAPER_LAYOUT.footerTitleWidthRatio),
            align: 'right',
            lineBreak: false,
        });
        doc.page.margins.bottom = savedBottom;
    }
}
// ── 知识图谱：纯文本层级列表 ────────────────────
//
// 委托书明确要求这一类「不渲染图形」：就是一张能印出来当目录看的层级清单。
// 版式和练习页/试卷都不一样：没有卷头、没有考生信息、没有答案页，
// 只有标题 + 一行说明 + 三级编号列表，右侧对齐每节的题量（这就是覆盖度）。
export function renderGraphPdf(tree) {
    const doc = new PDFDocument({
        size: 'A4',
        margins: MARGIN,
        bufferPages: true,
        info: { Title: tree.title, Creator: 'dsh-exam-gen' },
    });
    registerFonts(doc);
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    let pageCount = 0;
    const done = new Promise((resolve, reject) => {
        doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), pages: pageCount }));
        doc.on('error', reject);
    });
    doc.font('hei').fontSize(16).fillColor('#111');
    doc.text(tree.title, MARGIN.left, MARGIN.top, { width: CONTENT_WIDTH, align: 'center' });
    doc.moveDown(0.4);
    doc.font('song').fontSize(SMALL_SIZE + 0.5).fillColor('#555');
    doc.text(`共 ${tree.totalQuestions} 道题 · 括号内为该节点的题量（覆盖度）`, {
        width: CONTENT_WIDTH,
        align: 'center',
    });
    doc.moveDown(0.8);
    const row = (text, count, indent, font, size) => {
        ensureSpace(doc, 22);
        const y = doc.y;
        doc.font(font).fontSize(size).fillColor(indent === 0 ? '#111' : '#333');
        doc.text(text, MARGIN.left + indent, y, { width: CONTENT_WIDTH - indent - 46, lineBreak: false });
        if (count > 0) {
            doc.font('song').fontSize(SMALL_SIZE).fillColor('#777');
            doc.text(`${count} 题`, MARGIN.left + CONTENT_WIDTH - 46, y + 0.5, { width: 46, align: 'right', lineBreak: false });
        }
        doc.y = y + size + 5;
    };
    tree.nodes.forEach((grade, gi) => {
        const before = doc.y;
        if (before > MARGIN.top + 40)
            doc.moveDown(0.35);
        row(`${gi + 1}. ${grade.name}`, grade.count, 0, 'hei', 12);
        grade.children.forEach((chapter, ci) => {
            row(`${gi + 1}.${ci + 1}  ${chapter.name}`, chapter.count, 16, 'song', BODY_SIZE);
            chapter.children.forEach((point, pi) => {
                row(`${gi + 1}.${ci + 1}.${pi + 1}  第 ${point.name} 节`, point.count, 34, 'song', SMALL_SIZE + 0.5);
            });
        });
    });
    // 这一版页脚只放卷名 + 页码，不加密封线等卷面元素
    stampFooters(doc, tree.title);
    pageCount = doc.bufferedPageRange().count;
    doc.end();
    return done;
}
export function renderDrillPdf(input, options) {
    const doc = new PDFDocument({
        size: 'A4',
        margins: MARGIN,
        bufferPages: true,
        info: { Title: input.title, Creator: 'dsh-exam-gen' },
    });
    registerFonts(doc);
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    let pageCount = 0;
    const done = new Promise((resolve, reject) => {
        doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), pages: pageCount }));
        doc.on('error', reject);
    });
    const difficulties = [...new Set(input.variations.map((v) => v.difficulty))];
    doc.font('hei').fontSize(17).fillColor('#111');
    doc.text(input.title, MARGIN.left, MARGIN.top, { width: CONTENT_WIDTH, align: 'center' });
    doc.moveDown(0.45);
    doc.font('song').fontSize(SMALL_SIZE + 0.5).fillColor('#444');
    doc.text(`知识点：${input.topic}　　难度走向：${difficulties.join(' → ')}　　共 ${input.variations.length} 道`, {
        width: CONTENT_WIDTH,
        align: 'center',
    });
    doc.moveDown(0.7);
    doc.lineWidth(0.8).strokeColor('#999');
    const ruleY = doc.y;
    doc.moveTo(MARGIN.left, ruleY).lineTo(MARGIN.left + CONTENT_WIDTH, ruleY).stroke();
    doc.moveDown(0.6);
    doc.font('hei').fontSize(12).fillColor('#111');
    doc.text('〇、本知识点覆盖的专题', MARGIN.left, doc.y, { width: CONTENT_WIDTH });
    doc.moveDown(0.3);
    const topicList = input.topics && input.topics.length > 1 ? input.topics : [];
    if (topicList.length > 0) {
        // 两列排，省纸；每个专题后面带题库题量，学生知道哪块能刷够
        const half = Math.ceil(topicList.length / 2);
        const colWidth = CONTENT_WIDTH / 2;
        const startY = doc.y;
        let leftY = startY;
        let rightY = startY;
        topicList.forEach((topic, index) => {
            const isLeft = index < half;
            const x = MARGIN.left + (isLeft ? 0 : colWidth);
            const y = isLeft ? leftY : rightY;
            doc.font('song').fontSize(BODY_SIZE - 0.5).fillColor('#222');
            doc.text(`${index + 1}. ${topic.name}（${topic.count} 题）`, x + 2, y, { width: colWidth - 8 });
            if (isLeft)
                leftY = doc.y;
            else
                rightY = doc.y;
        });
        doc.y = Math.max(leftY, rightY) + 4;
    }
    else {
        doc.font('song').fontSize(BODY_SIZE - 0.5).fillColor('#444');
        doc.text(`本知识点直接按 ${input.variations.length} 道递进题练透。`, MARGIN.left + 2, doc.y, { width: CONTENT_WIDTH - 8 });
    }
    doc.moveDown(0.7);
    doc.font('hei').fontSize(12).fillColor('#111');
    doc.text('一、题目（按难度递进）', MARGIN.left, doc.y, { width: CONTENT_WIDTH });
    doc.moveDown(0.4);
    input.variations.forEach((variation, index) => {
        const labelWidth = 22;
        ensureSpace(doc, 60);
        const startY = doc.y;
        // 难度标签（右上角小方块感的文字，不用画框，避免视觉噪音）
        doc.save();
        doc.font('hei').fontSize(SMALL_SIZE - 0.5).fillColor(variation.difficulty === '拔高' ? '#8a2f2f' : '#666');
        doc.text(variation.difficulty, MARGIN.left + CONTENT_WIDTH - 40, startY, { width: 40, align: 'right', lineBreak: false });
        doc.restore();
        doc.font('song').fontSize(BODY_SIZE).fillColor('#111');
        doc.text(`${index + 1}.`, MARGIN.left, startY, { width: labelWidth, lineBreak: false });
        const badge = variation.topic ? `［${variation.topic}］` : '';
        let cursorY = flowMath(doc, normalizeExponents(badge + variation.stem), MARGIN.left + labelWidth, startY, CONTENT_WIDTH - labelWidth - 46, {
            size: BODY_SIZE,
        });
        // 作答空间
        cursorY += 2;
        doc.save();
        doc.font('song').fontSize(SMALL_SIZE).fillColor('#666');
        doc.text('答：', MARGIN.left + labelWidth, cursorY + 4, { width: 24, lineBreak: false });
        doc.lineWidth(0.7).strokeColor('#333');
        doc.moveTo(MARGIN.left + labelWidth + 26, cursorY + 14);
        doc.lineTo(MARGIN.left + labelWidth + 220, cursorY + 14);
        doc.stroke();
        doc.restore();
        cursorY += 22;
        // 变式说明
        doc.save();
        doc.font('song').fontSize(SMALL_SIZE - 1).fillColor('#777');
        const noteText = `变式说明：${variation.variation_note}`;
        doc.text(noteText, MARGIN.left + labelWidth, cursorY, { width: CONTENT_WIDTH - labelWidth });
        cursorY = doc.y;
        doc.restore();
        doc.y = cursorY + 8;
    });
    // 方法总结
    if (input.summary.length > 0) {
        ensureSpace(doc, 80);
        doc.moveDown(0.8);
        doc.font('hei').fontSize(12).fillColor('#111');
        doc.text('二、方法总结', MARGIN.left, doc.y, { width: CONTENT_WIDTH });
        doc.moveDown(0.4);
        input.summary.forEach((line, index) => {
            ensureSpace(doc, 26);
            doc.font('song').fontSize(BODY_SIZE - 0.5).fillColor('#222');
            doc.text(`${index + 1}. ${line}`, MARGIN.left + 4, doc.y, { width: CONTENT_WIDTH - 8 });
            doc.moveDown(0.15);
        });
    }
    // 答案与解析单独起页
    if (options.withAnswer) {
        doc.addPage();
        doc.font('hei').fontSize(14).fillColor('#111');
        doc.text('参考答案与解析', MARGIN.left, MARGIN.top, { width: CONTENT_WIDTH, align: 'center' });
        doc.moveDown(0.8);
        input.variations.forEach((variation, index) => {
            ensureSpace(doc, 40);
            doc.font('hei').fontSize(BODY_SIZE).fillColor('#111');
            doc.text(`${index + 1}.`, MARGIN.left, doc.y, { width: 22, lineBreak: false });
            const y = doc.y;
            doc.font('song').fontSize(BODY_SIZE).fillColor('#111');
            doc.text(variation.answer, MARGIN.left + 22, y, { width: CONTENT_WIDTH - 22 });
            if (variation.explanation) {
                doc.font('song').fontSize(BODY_SIZE - 0.5).fillColor('#444');
                doc.text(variation.explanation, MARGIN.left + 22, doc.y, { width: CONTENT_WIDTH - 22 });
            }
            doc.moveDown(0.3);
        });
    }
    stampFooters(doc, input.title);
    pageCount = doc.bufferedPageRange().count;
    doc.end();
    return done;
}
export function renderLessonPdf(input, options) {
    const doc = new PDFDocument({
        size: 'A4',
        margins: MARGIN,
        bufferPages: true,
        info: { Title: input.title, Creator: 'dsh-exam-gen' },
    });
    registerFonts(doc);
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    let pageCount = 0;
    const done = new Promise((resolve, reject) => {
        doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), pages: pageCount }));
        doc.on('error', reject);
    });
    // 卷头
    doc.font('hei').fontSize(17).fillColor('#111');
    doc.text(input.title, MARGIN.left, MARGIN.top, { width: CONTENT_WIDTH, align: 'center' });
    doc.moveDown(0.4);
    doc.font('song').fontSize(SMALL_SIZE + 0.5).fillColor('#555');
    doc.text(`适用：${input.grade ?? ''}　　主题：${input.topic}　　本讲义配套 ${input.exercises.length} 道练习`, {
        width: CONTENT_WIDTH,
        align: 'center',
    });
    doc.moveDown(0.8);
    // 小节标题：左侧一道短竖线 + 黑体，和卷子的「一、二、」编号区分开
    const sectionTitle = (text) => {
        ensureSpace(doc, 50);
        doc.moveDown(0.5);
        const y = doc.y;
        doc.save();
        doc.rect(MARGIN.left, y + 1.5, 3, 13).fill('#333');
        doc.restore();
        doc.font('hei').fontSize(12.5).fillColor('#111');
        doc.text(text, MARGIN.left + 10, y, { width: CONTENT_WIDTH - 10 });
        doc.moveDown(0.35);
    };
    const paragraph = (text, indent = 0, size = BODY_SIZE, color = '#222') => {
        ensureSpace(doc, 30);
        doc.font('song').fontSize(size).fillColor(color);
        doc.text(text, MARGIN.left + indent, doc.y, { width: CONTENT_WIDTH - indent, lineGap: 3 });
        doc.moveDown(0.2);
    };
    for (const section of input.sections) {
        if (section.type === 'example') {
            sectionTitle(section.title);
            if (!input.example)
                continue;
            const example = input.example;
            paragraph(example.stem);
            if (example.options?.length) {
                const y = drawOptions(doc, example.options, doc.y);
                doc.y = y;
            }
            paragraph(`答案：${example.answer}`, 0, BODY_SIZE - 0.5, '#111');
            if (example.explanation) {
                // 解析单独缩进 + 左侧细线，和题目区分开
                ensureSpace(doc, 40);
                const startY = doc.y;
                doc.save();
                doc.rect(MARGIN.left + 8, startY, 1.4, Math.max(12, doc.heightOfString(example.explanation, { width: CONTENT_WIDTH - 40 }))).fill('#ccc');
                doc.restore();
                doc.font('song').fontSize(BODY_SIZE - 0.5).fillColor('#444');
                doc.text(`解析：${example.explanation}`, MARGIN.left + 18, startY, { width: CONTENT_WIDTH - 26, lineGap: 3 });
                doc.moveDown(0.3);
            }
        }
        else if (section.type === 'exercise') {
            sectionTitle(section.title);
            input.exercises.forEach((item, index) => {
                ensureSpace(doc, 52);
                const startY = doc.y;
                // 题号并进 flowMath 一起排版，否则题号和题干会差一行（各自用不同的 y 基准）
                let cursorY = flowMath(doc, `${index + 1}. ${normalizeExponents(item.stem)}`, MARGIN.left, startY, CONTENT_WIDTH, { size: BODY_SIZE });
                if (item.options?.length) {
                    cursorY = drawOptions(doc, item.options, cursorY + 3);
                }
                // 留作答空间
                doc.save();
                doc.lineWidth(0.6).strokeColor('#bbb');
                for (let line = 0; line < 3; line += 1) {
                    const ly = cursorY + 10 + line * 18;
                    doc.moveTo(MARGIN.left, ly).lineTo(MARGIN.left + CONTENT_WIDTH - 40, ly).stroke();
                }
                doc.restore();
                doc.y = cursorY + 10 + 3 * 18 + 6;
            });
        }
        else {
            sectionTitle(section.title);
            section.lines.forEach((line) => paragraph(line));
        }
    }
    // 练习答案单独一页
    if (options.withAnswer && input.exercises.length > 0) {
        doc.addPage();
        doc.font('hei').fontSize(14).fillColor('#111');
        doc.text('练习答案', MARGIN.left, MARGIN.top, { width: CONTENT_WIDTH, align: 'center' });
        doc.moveDown(0.8);
        input.exercises.forEach((item, index) => {
            ensureSpace(doc, 40);
            // 编号和答案写在同一行：分开画会因 width 限制各起一行，看起来像错位
            doc.font('song').fontSize(BODY_SIZE).fillColor('#111');
            doc.text(`${index + 1}. ${item.answer}`, MARGIN.left, doc.y, { width: CONTENT_WIDTH });
            if (item.explanation) {
                doc.font('song').fontSize(BODY_SIZE - 0.5).fillColor('#444');
                doc.text(item.explanation, MARGIN.left + 22, doc.y, { width: CONTENT_WIDTH - 22 });
            }
            doc.moveDown(0.4);
        });
    }
    stampFooters(doc, input.title);
    pageCount = doc.bufferedPageRange().count;
    doc.end();
    return done;
}
function normalizeType(type) {
    if (type === 'choice')
        return 'choice';
    if (type === 'multi')
        return 'multi';
    if (type === 'fill')
        return 'fill';
    return 'solve';
}
function chineseNumber(n) {
    return ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][n - 1] ?? String(n);
}
export function renderSyncPdf(paper, options) {
    const doc = new PDFDocument({
        size: 'A4',
        margins: MARGIN,
        bufferPages: true,
        info: { Title: paper.title, Creator: 'dsh-exam-gen' },
    });
    registerFonts(doc);
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    let pageCount = 0;
    const done = new Promise((resolve, reject) => {
        doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), pages: pageCount }));
        doc.on('error', reject);
    });
    const basic = paper.questions.filter((q) => q.tier !== 'advanced');
    const advanced = paper.questions.filter((q) => q.tier === 'advanced');
    const totalPoints = options.totalPoints ?? sumPoints(paper);
    // 卷头
    doc.font('hei').fontSize(17).fillColor('#111');
    doc.text(paper.title, MARGIN.left, MARGIN.top, { width: CONTENT_WIDTH, align: 'center' });
    doc.moveDown(0.45);
    doc.font('song').fontSize(SMALL_SIZE + 0.5).fillColor('#444');
    const info = [options.textbook, options.lesson].filter(Boolean).join(' · ');
    if (info)
        doc.text(info, { width: CONTENT_WIDTH, align: 'center' });
    doc.moveDown(0.3);
    doc.font('song').fontSize(SMALL_SIZE + 0.5).fillColor('#333');
    doc.text(`满分：${totalPoints} 分　　基础题 ${basic.length} 道　　提高题 ${advanced.length} 道`, { width: CONTENT_WIDTH, align: 'center' });
    doc.moveDown(0.6);
    doc.lineWidth(0.8).strokeColor('#999');
    const ruleY = doc.y;
    doc.moveTo(MARGIN.left, ruleY).lineTo(MARGIN.left + CONTENT_WIDTH, ruleY).stroke();
    doc.moveDown(0.5);
    doc.font('song').fontSize(SMALL_SIZE + 0.5).fillColor('#333');
    doc.text('姓名：____________　　班级：____________　　日期：____________', MARGIN.left, doc.y, {
        width: CONTENT_WIDTH,
    });
    let sectionNo = 0;
    const drawSection = (title, group) => {
        if (group.length === 0)
            return;
        ensureSpace(doc, 46);
        doc.moveDown(0.7);
        doc.font('hei').fontSize(12).fillColor('#111');
        doc.text(`${chineseNumber(++sectionNo)}、${title}`, MARGIN.left, doc.y, { width: CONTENT_WIDTH });
        doc.moveDown(0.3);
        group.forEach((question, i) => drawSyncQuestion(doc, i + 1, question));
    };
    drawSection('基础题（先把课本上的弄熟）', basic);
    drawSection('提高题（往卷子难度上够一够）', advanced);
    if (options.withAnswer) {
        doc.addPage();
        drawAnswerPage(doc, paper);
    }
    stampFooters(doc, paper.title);
    pageCount = doc.bufferedPageRange().count;
    doc.end();
    return done;
}
function drawSyncQuestion(doc, number, question) {
    const labelWidth = 22;
    // 右侧留出掌握度勾选格，题干宽度相应收窄
    const checkWidth = 92;
    const bodyWidth = CONTENT_WIDTH - labelWidth - checkWidth;
    ensureSpace(doc, 46);
    const startY = doc.y;
    doc.font('song').fontSize(BODY_SIZE).fillColor('#111');
    doc.text(`${number}.`, MARGIN.left, startY, { width: labelWidth, lineBreak: false });
    let cursorY = flowMath(doc, normalizeExponents(question.content), MARGIN.left + labelWidth, startY, bodyWidth, {
        size: BODY_SIZE,
    });
    const options = question.options ?? [];
    if (options.length > 0) {
        cursorY += 3;
        cursorY = drawOptions(doc, options, cursorY);
    }
    else if (normalizeType(question.type) === 'solve') {
        const lines = Math.max(3, Math.min(10, Math.round((question.points || 10) / 3)));
        cursorY += lines * BODY_LINE * 0.9;
    }
    else if (!/[＿_]{2,}/.test(question.content)) {
        const lineY = cursorY + 7;
        doc.save();
        doc.font('song').fontSize(SMALL_SIZE).fillColor('#666');
        doc.text('答：', MARGIN.left + labelWidth, cursorY - 1, { width: 24, lineBreak: false });
        doc.lineWidth(0.7).strokeColor('#333');
        doc.moveTo(MARGIN.left + labelWidth + 26, lineY);
        doc.lineTo(MARGIN.left + labelWidth + 200, lineY);
        doc.stroke();
        doc.restore();
        cursorY += 20;
    }
    else {
        cursorY += 6;
    }
    // 右侧掌握度勾选格（每题的纵向中线对齐题干首行）
    doc.save();
    doc.font('song').fontSize(SMALL_SIZE - 0.5).fillColor('#888');
    doc.text('□ 会    □ 不太会', MARGIN.left + CONTENT_WIDTH - checkWidth, startY + 1, {
        width: checkWidth,
        align: 'right',
        lineBreak: false,
    });
    doc.restore();
    // 知识点标注
    if (question.topic) {
        doc.save();
        doc.font('song').fontSize(SMALL_SIZE - 1).fillColor('#777');
        doc.text(`〔知识点：${question.topic}〕`, MARGIN.left + labelWidth, cursorY - 2, {
            width: bodyWidth,
            lineBreak: false,
        });
        doc.restore();
        cursorY += 12;
    }
    doc.y = cursorY + 8;
}
