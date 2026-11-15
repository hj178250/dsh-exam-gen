/**
 * 从用户原话里解析出题参数。
 *
 * 为什么要这一层：工具参数表是**常驻成本** —— 每轮对话都要把 schema 发给模型，
 * 十几个参数加起来约 800 token，跟用户出不出题无关。把参数表压成 { brief, quality } 两个，
 * 其余在这里解析，schema 立刻降到 150 左右，省下的钱每一轮都在省。
 *
 * 原则：能解析出来的就解析，解析不出来的用默认值，绝不因为「没说清楚」卡住用户。
 */
const GRADES = [
    '初一', '初二', '初三', '高一', '高二', '高三',
    '七年级', '八年级', '九年级', '十年级',
    '一年级', '二年级', '三年级', '四年级', '五年级', '六年级',
];
const GRADE_ALIAS = {
    七年级: '初一', 八年级: '初二', 九年级: '初三',
    一年级: '小一', 二年级: '小二', 三年级: '小三',
    四年级: '小四', 五年级: '小五', 六年级: '小六',
};
const SUBJECTS = ['数学', '物理', '化学', '生物', '语文', '英语', '历史', '地理', '政治', '科学'];
/** 中文数字（够用到三十）。 */
const CN_NUM = {
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};
function parseCount(text) {
    // 优先「8 道」「8题」「10 个题」这类阿拉伯数字
    const arabic = text.match(/(\d{1,2})\s*(?:道|题|个题|个小题)/);
    if (arabic) {
        const value = Number(arabic[1]);
        if (value >= 1 && value <= 60)
            return value;
    }
    // 再试中文数字：「三道题」「二十道」
    const chinese = text.match(/([一二两三四五六七八九十]{1,2})\s*(?:道|题|个题)/);
    if (chinese) {
        const raw = chinese[1];
        if (raw.length === 1) {
            const single = CN_NUM[raw];
            if (single)
                return single;
        }
        else if (raw.startsWith('十')) {
            const rest = CN_NUM[raw[1] ?? ''];
            return rest ? 10 + rest : 10;
        }
        else if (raw.endsWith('十')) {
            const head = CN_NUM[raw[0] ?? ''];
            return head ? head * 10 : 10;
        }
        else if (raw[1] === '十') {
            const head = CN_NUM[raw[0] ?? ''];
            const rest = CN_NUM[raw[2] ?? ''];
            if (head)
                return head * 10 + (rest ?? 0);
        }
    }
    return undefined;
}
function detectMode(text) {
    if (/同步|教材|课本|课时/.test(text))
        return 'sync';
    if (/专项|变式|突破|专题训练/.test(text))
        return 'drill';
    if (/讲义|教案|备课|上课用|讲解材料/.test(text))
        return 'lesson';
    if (/图谱|知识树|知识结构|思维导图|梳理.*结构/.test(text))
        return 'graph';
    return 'paper';
}
function detectTypes(text) {
    const choice = /选择/.test(text);
    const fill = /填空/.test(text);
    const solve = /解答|计算|证明|大题/.test(text);
    const hits = [choice, fill, solve].filter(Boolean).length;
    if (hits > 1)
        return 'mixed';
    if (choice)
        return 'choice';
    if (fill)
        return 'fill';
    if (solve)
        return 'solve';
    return 'choice';
}
function detectDifficulty(text) {
    if (/拔高|压轴|难|挑战|竞赛/.test(text))
        return '拔高';
    if (/基础|简单|入门|容易|巩固/.test(text))
        return '基础';
    return '中等';
}
/**
 * 从已识别词之外剥掉的杂词：模式词、动作词、量词、版本词、难度词、答案词。
 * 不剥干净的话 scope 会变成「相似专项突破 变式」这种，检索时反而召不准。
 */
const NOISE = [
    '专项突破', '专项', '突破', '变式', '讲义', '教案', '备课', '知识图谱', '图谱', '知识树', '知识结构',
    '思维导图', '梳理', '同步练习', '同步', '教材', '课本', '课时', '试卷', '卷子', '练习题', '练习', '题目',
    '帮我', '给我', '请', '写', '做', '出', '来', '生成', '一套', '一份', '一张', '一个', '一些',
    '我要', '我想', '想要', '麻烦', '需要', '能不能', '可以', '帮我出',
    '人教版', '苏教版', '北师大版', '沪教版', '外研版', '湘教版', '鲁教版', '浙教版', '部编版',
    '拔高', '基础', '简单', '容易', '入门', '巩固', '中等', '压轴', '挑战', '竞赛',
    '高中', '初中', '小学', '答案', '解析', '压轴题', '题',
];
/** 去掉已识别的词，剩下的当中文范围（章节名）。 */
function detectScope(text, matched) {
    let rest = text;
    for (const token of [...matched, ...NOISE]) {
        if (token)
            rest = rest.split(token).join(' ');
    }
    rest = rest
        .replace(/\d+\s*(?:道|题|个题|个小题)/g, ' ')
        .replace(/[一二两三四五六七八九十]{1,2}\s*(?:道|题|个题)/g, ' ')
        .replace(/(?:不要|需要|要|了|吧|呢|啊|，|,|。|、|：|:)/g, ' ')
        .replace(/的(?=\s|$)/g, ' ')
        .replace(/第\s*[一二三四五六七八九十\d]+\s*[章节]/g, ' ')
        .replace(/\d+\.\d+(\.\d+)?/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    // 范围不超过 20 字：太长说明抓到的是整句话，宁可丢掉让检索走默认
    if (rest.length > 20)
        return '';
    // 只剩代词/语气词时也丢掉：「我要出一套卷子」剥完只剩「我」，当范围会把检索带偏
    if (/^[我你他她它咱俺您想要的了吗呢啊吧哦嗯哈呀，。！？\s]*$/.test(rest))
        return '';
    if (rest.length < 2)
        return '';
    return rest;
}
export function parseBrief(brief) {
    const text = (brief ?? '').trim();
    const matched = [];
    const mode = detectMode(text);
    let grade = '';
    for (const candidate of GRADES) {
        if (text.includes(candidate)) {
            grade = GRADE_ALIAS[candidate] ?? candidate;
            matched.push(candidate);
            break;
        }
    }
    let subject = '';
    for (const candidate of SUBJECTS) {
        if (text.includes(candidate)) {
            subject = candidate;
            matched.push(candidate);
            break;
        }
    }
    const count = parseCount(text) ?? (mode === 'graph' ? 0 : 5);
    const difficulty = detectDifficulty(text);
    const types = detectTypes(text);
    const withAnswer = !/(不附|不要答案|不需要答案|无答案|只.*题目)/.test(text);
    // 只说了学段没说年级（「高中数学」「初中物理」）时给个代表年级，
    // 锚点和检索都靠 stage 兜底，这里只是不让 grade 空着。
    let resolvedGrade = grade;
    if (!resolvedGrade) {
        if (/高中/.test(text))
            resolvedGrade = '高一';
        else if (/初中/.test(text))
            resolvedGrade = '初一';
        else
            resolvedGrade = '初一';
    }
    // 范围和章节：把年级/科目/题型这些词剥掉后剩下的部分
    for (const token of [grade, subject, '选择题', '填空题', '解答题', '计算题', '证明题']) {
        if (token && text.includes(token))
            matched.push(token);
    }
    const scope = detectScope(text, matched.filter(Boolean));
    return {
        mode,
        grade: resolvedGrade,
        subject: subject || '数学',
        scope,
        count: Math.min(Math.max(count, mode === 'graph' ? 0 : 1), 40),
        difficulty,
        types,
        withAnswer,
        matched,
    };
}
