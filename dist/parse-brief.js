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
/**
 * 考试名 → 代表年级。
 * 用户说「模拟高考数学卷」时，他没说「高三」，但意图非常明确：按高考卷面出。
 * 不认这两个词的话，grade 会落到默认的初一，卷面规格也跟着变成中考卷——整份卷子就错了。
 */
const EXAM_GRADE = {
    高考: '高三',
    中考: '初三',
    小升初: '小六',
};
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
    // 「题目」「一道题」里的「一」不是题量，别当成 1 道
    // 只认「三道题」「二十道」这种真在数数的写法
    const chinese = text.match(/([一二两三四五六七八九十]{1,2})\s*(?:道|个题)/);
    if (chinese) {
        const raw = chinese[1];
        if (raw === '一')
            return undefined;
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
    // 用户没说题型 → 出完整卷（选择+填空+解答），不是清一色选择题。
    // 只有他明说「选择题」「填空题」才锁单一题型。
    return 'mixed';
}
function detectDifficulty(text) {
    // 「难(?!度)」避免把「难度」里的「难」误判成「拔高难」。
    if (/拔高|压轴|难(?!度)|挑战|竞赛/.test(text))
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
    '难度', '带答案', '附答案', '含答案', '带解析', '附解析', '含解析', '答案和解析',
    // client 组合 brief 用的结构化标签词（「年级：」「范围：」「题量：」等），
    // 必须剥掉否则 scope 会残留「范围 题量 难度」这些标签。
    '年级', '范围', '题量', '题型', '答案', '版本', '主题', '知识点范围', '章节',
    '混合', '选择', '填空', '解答', '多选', '单选', '共', '附', '和', '解析',
    // 「教学讲义」→「讲义」剥掉后残留「教学」，一并剥掉避免 scope 变「教学 函数的概念」
    '教学',
    // 「高考/中考」是卷面类型而不是章节范围：识别成年级后必须剥掉，
    // 否则 scope 会变成「模拟高考」这种假章节，检索全空。
    '高考', '中考', '新高考', '模拟', '仿真', '模拟考', '模考', '卷',
    // 模型常把 brief 补全成「出一套模拟高考化学卷（高三化学，高考模拟卷，完整套卷）」——
    // 括号里这些词一旦漏剥，就会变成 scope「（ 完整套 ）」，卷名和检索全被带偏。
    '完整套', '完整', '全套', '整卷', '整套', '高考模拟', '模拟题', '成套',
];
/** 去掉已识别的词，剩下的当中文范围（章节名）。 */
function detectScope(text, matched) {
    let rest = text;
    // 长词先替换：否则「题」这个单字会先把「题量」拆成「量」，长标签永远匹配不到。
    const tokens = [...matched, ...NOISE].filter(Boolean).sort((a, b) => b.length - a.length);
    for (const token of tokens) {
        if (token)
            rest = rest.split(token).join(' ');
    }
    rest = rest
        .replace(/\d+\s*(?:道|题|个题|个小题)/g, ' ')
        .replace(/[一二两三四五六七八九十]{1,2}\s*(?:道|题|个题)/g, ' ')
        .replace(/(?:不要|需要|要|了|吧|呢|啊|，|,|。|、|：|:|·|\s)/g, ' ')
        .replace(/的(?=\s|$)/g, ' ')
        .replace(/第\s*[一二三四五六七八九十\d]+\s*[章节]/g, ' ')
        .replace(/\d+\.\d+(\.\d+)?/g, ' ')
        // 中英文括号本身也剥掉：模型爱把补充说明塞进括号，括号留着会成为 scope 的一部分
        .replace(/[（）()【】\[\]「」『』]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    // 范围不超过 20 字：太长说明抓到的是整句话，宁可丢掉让检索走默认
    if (rest.length > 20)
        return '';
    // 只剩代词/语气词时也丢掉：「我要出一套卷子」剥完只剩「我」，当范围会把检索带偏
    if (/^[我你他她它咱俺您想要的了吗呢啊吧哦嗯哈呀，。！？\s]*$/.test(rest))
        return '';
    // 剥完只剩难度/答案这类修饰词时也丢掉：「中等难度 · 带答案」剥完剩「难度 带」
    if (/^(难度|带|附|含|中等|基础|拔高|答案|解析|和|的|\s)+$/.test(rest))
        return '';
    // 尾巴上残留的「测/卷/试卷」是「数学测试卷」这类词被局部剥掉后的碎片，去掉再判断
    rest = rest.replace(/(?:测试卷|测试|试卷|卷子|卷|测)+$/, '').trim();
    // 数字碎片也不算范围：「19题」「2道」剥完后留下的「19」「2」
    if (/^[\d\s、,，.]+$/.test(rest))
        return '';
    if (rest.length < 2)
        return '';
    return rest;
}
export function parseBrief(brief) {
    const text = (brief ?? '').trim();
    const matched = [];
    const mode = detectMode(text);
    // 收集所有说到的年级（参数卡多选后，模型复述的 brief 是「初一,初二 数学」这种逗号串）。
    // grade 仍是「第一个」，供卷面规格/检索兜底；grades 保留全部，供跨年级组卷。
    const foundGrades = [];
    for (const candidate of GRADES) {
        if (text.includes(candidate)) {
            const normalized = GRADE_ALIAS[candidate] ?? candidate;
            if (!foundGrades.includes(normalized))
                foundGrades.push(normalized);
            matched.push(candidate);
        }
    }
    let grade = foundGrades[0] ?? '';
    // 没说具体年级但说了考试名（高考/中考）→ 按该考试的卷面走。
    // 「模拟高考」里的「高考」，和「高三」表达的是同一件事。
    if (!grade) {
        for (const [exam, mapped] of Object.entries(EXAM_GRADE)) {
            if (text.includes(exam)) {
                grade = mapped;
                foundGrades.push(mapped);
                matched.push(exam);
                break;
            }
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
    // 「出一套卷子」但没说几道、没说题型 → 题型/题数都算没点明，index.ts 会弹卡问。
    const explicitCount = parseCount(text) !== undefined;
    const explicitTypes = /选择|填空|解答|计算|证明|大题/.test(text);
    // 「一套/整卷/模拟/高考」= 用户要的是一整张标准卷。
    // 这时题数和题型都按卷面规格来（高考 19 题、中考 22 题），不该再弹卡问他「几道题」。
    // 注意只认「考试名」不认「卷」字：「初一上册数学卷」仍需弹卡问题量，
    // 而「模拟高考化学卷」不用——后者卷面是国家定的，没有可选项。
    const explicitSheet = /一套|整卷|整套|全套|一整|一份完整|完整卷|模拟|仿真|模考|高考|中考|真题/.test(text);
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
    // 兜底年级也进 grades，保证「grade ∈ grades」恒成立
    if (foundGrades.length === 0)
        foundGrades.push(resolvedGrade);
    // 范围和章节：把年级/科目/题型这些词剥掉后剩下的部分
    for (const token of [grade, subject, '选择题', '填空题', '解答题', '计算题', '证明题']) {
        if (token && text.includes(token))
            matched.push(token);
    }
    const scope = detectScope(text, matched.filter(Boolean));
    // 说「模拟高考卷/一套整卷」而没点册别时，范围就是整个考试大纲 —— 不该拿残渣当范围。
    // 实测模型把 brief 补全成「出一套模拟高考数学卷，完整一套（含选择、填空、解答），新高考I卷风格，难度接近真题」，
    // 剥完只剩「含 新 I 风格 接近真」，直接进卷名变成「高三数学 · 含选择 填空 解答 新 I 风格 接近真」。
    // 只有真的点了册别（必修一 / 选必二 / 上册 / 第X章 / 某单元）才保留范围。
    const namedBook = /必修|选必|选择性必修|册|单元|第\s*[一二三四五六七八九十\d]+\s*[章节]/.test(text);
    const finalScope = explicitSheet && !namedBook ? '' : scope;
    return {
        mode,
        grade: resolvedGrade,
        grades: foundGrades,
        subject: subject || '数学',
        scope: finalScope,
        count: Math.min(Math.max(count, mode === 'graph' ? 0 : 1), 40),
        difficulty,
        types,
        withAnswer,
        // 只有说清具体年级（初一二三、高一二三）才算「点明了年级」。
        // 只说「高中」「初中」时 explicitGrade=false → 会弹卡让用户选具体年级，
        // 卡片里默认已勾上高一/初一（resolvedGrade），点一下确认就行。
        explicitGrade: !!grade,
        explicitSubject: !!subject,
        explicitCount,
        explicitTypes,
        explicitSheet,
        // 用户说「让我选/弹参数卡」时，无条件先弹卡
        wantCard: /让我选|选一下|选一选|自己选|参数卡|弹.{0,4}(卡|框)|选参数/.test(text),
        matched,
    };
}
