/**
 * 卷面规格表：把「真实学校考试」的卷子结构硬编码进来。
 *
 * 甲方的核心诉求：出一套卷子就是一套真卷子 —— 选择题几道、填空题几道、
 * 大题几道、每题几分、考多长时间、总分多少，都要跟学校考试的卷面一致，提前录好，
 * 而不是「5 道选择题」这种敷衍。用户说的范围（初一上册 / 高一必修一 / 高考）不同，
 * 卷子结构和覆盖的章节也不同。
 *
 * 另一半是「考点骨架」（BLUEPRINTS）：每一题考什么、多少分、什么难度，也提前写死。
 * 出卷时模型只负责把骨架填成题目，不用自己想「第 15 题该考什么」。
 */
/** 一个板块的实际总分：有 points 数组按数组算，否则 count × pointsEach。 */
export function sectionPoints(section) {
    if (section.points && section.points.length === section.count) {
        return section.points.reduce((sum, n) => sum + n, 0);
    }
    return section.count * section.pointsEach;
}
/** 各板块题数之和。 */
export function totalCount(spec) {
    return spec.sections.reduce((sum, section) => sum + section.count, 0);
}
/** 展开成逐题分值序列，如 [5,5,...,13,15,15,17,17]。 */
export function scoreSequence(spec) {
    const out = [];
    for (const section of spec.sections) {
        if (section.points && section.points.length === section.count) {
            out.push(...section.points);
        }
        else {
            for (let i = 0; i < section.count; i += 1)
                out.push(section.pointsEach);
        }
    }
    return out;
}
function build(id, label, minutes, sections) {
    return {
        id,
        label,
        minutes,
        sections,
        totalPoints: sections.reduce((sum, section) => sum + sectionPoints(section), 0),
    };
}
/**
 * 高考数学新课标卷（新高考 Ⅰ 卷）真实结构：
 * 单选 8 × 5 = 40；多选 3 × 6 = 18；填空 3 × 5 = 15；解答 5 题 13+15+15+17+17 = 77。
 * 共 19 题，满分 150，120 分钟。
 */
const SENIOR_MATH = build('senior-math', '高考数学新课标卷', 120, [
    { type: 'choice', count: 8, pointsEach: 5 },
    { type: 'multi', count: 3, pointsEach: 6 },
    { type: 'fill', count: 3, pointsEach: 5 },
    { type: 'solve', count: 5, pointsEach: 15, points: [13, 15, 15, 17, 17] },
]);
/** 初中数学期末/中考卷结构：选择 10 × 3；填空 6 × 4；解答 6 题（前 3 题 10、后 3 题 12）。 */
const JUNIOR_MATH = build('junior-math', '中考数学卷', 90, [
    { type: 'choice', count: 10, pointsEach: 3 },
    { type: 'fill', count: 6, pointsEach: 4 },
    { type: 'solve', count: 6, pointsEach: 11 },
]);
/** 高中物理卷（理综单科风格）：选择 8 × 5；填空 4 × 5；解答 5 题 = 80。 */
const SENIOR_PHYSICS = build('senior-physics', '高考物理卷', 90, [
    { type: 'choice', count: 8, pointsEach: 5 },
    { type: 'fill', count: 4, pointsEach: 5 },
    { type: 'solve', count: 5, pointsEach: 16 },
]);
/** 初中物理卷：选择 10 × 3；填空 6 × 4；解答 5 题 = 54。 */
const JUNIOR_PHYSICS = build('junior-physics', '中考物理卷', 60, [
    { type: 'choice', count: 10, pointsEach: 3 },
    { type: 'fill', count: 6, pointsEach: 4 },
    { type: 'solve', count: 5, pointsEach: 11 },
]);
/**
 * 高考化学卷（新高考单科）真实结构：
 * 选择题 14 题 × 3 = 42；非选择题 4 题 14+14+15+15 = 58。共 18 题，满分 100，75 分钟。
 */
const SENIOR_CHEMISTRY = build('senior-chemistry', '高考化学卷', 75, [
    { type: 'choice', count: 14, pointsEach: 3 },
    { type: 'solve', count: 4, pointsEach: 15, points: [14, 14, 15, 15] },
]);
/** 初中化学卷：选择 10 × 3；填空 6 × 4；解答 4 题 = 42。 */
const JUNIOR_CHEMISTRY = build('junior-chemistry', '中考化学卷', 50, [
    { type: 'choice', count: 10, pointsEach: 3 },
    { type: 'fill', count: 6, pointsEach: 4 },
    { type: 'solve', count: 4, pointsEach: 11 },
]);
/** 生物：两学段共用一套结构（题量略少）。 */
const BIOLOGY = build('biology', '生物卷', 50, [
    { type: 'choice', count: 12, pointsEach: 2 },
    { type: 'fill', count: 6, pointsEach: 3 },
    { type: 'solve', count: 4, pointsEach: 11 },
]);
const SPECS = {
    'senior-math': SENIOR_MATH,
    'junior-math': JUNIOR_MATH,
    'senior-physics': SENIOR_PHYSICS,
    'junior-physics': JUNIOR_PHYSICS,
    'senior-chemistry': SENIOR_CHEMISTRY,
    'junior-chemistry': JUNIOR_CHEMISTRY,
    'junior-biology': BIOLOGY,
    'senior-biology': BIOLOGY,
};
export function stageOfGrade(grade) {
    return /高一|高二|高三|高中/.test(grade) ? 'senior' : 'junior';
}
const SUBJECT_KEY = {
    数学: 'math',
    物理: 'physics',
    化学: 'chemistry',
    生物: 'biology',
};
/** 按学段 + 学科取卷面规格；没配的学科给一套保守默认（10 选择 + 4 填空 + 4 解答）。 */
export function specFor(grade, subject) {
    const stage = stageOfGrade(grade);
    const key = `${stage}-${SUBJECT_KEY[subject] ?? subject}`;
    const hit = SPECS[key];
    if (hit)
        return hit;
    return build(`${stage}-${subject}`, `${stage === 'senior' ? '高中' : '初中'}${subject}卷`, 90, [
        { type: 'choice', count: 10, pointsEach: 3 },
        { type: 'fill', count: 4, pointsEach: 4 },
        { type: 'solve', count: 4, pointsEach: 12 },
    ]);
}
/**
 * 高考数学新课标卷考点骨架（19 题）。
 * 顺序即卷面顺序：单选 8 → 多选 3 → 填空 3 → 解答 5。
 */
const MATH_SENIOR_BLUEPRINT = [
    { type: 'choice', topic: '集合的交并补与不等式解集', tier: '基础' },
    { type: 'choice', topic: '复数的四则运算与共轭、模', tier: '基础' },
    { type: 'choice', topic: '平面向量的数量积与坐标运算', tier: '基础' },
    { type: 'choice', topic: '三角恒等变换与三角函数图象性质', tier: '中等' },
    { type: 'choice', topic: '等差数列与等比数列的基本量', tier: '中等' },
    { type: 'choice', topic: '空间线面位置关系的判定', tier: '中等' },
    { type: 'choice', topic: '古典概型与条件概率', tier: '中等' },
    { type: 'choice', topic: '函数单调性与导数比较大小', tier: '拔高' },
    { type: 'multi', topic: '圆锥曲线的离心率与渐近线（多选）', tier: '中等' },
    { type: 'multi', topic: '立体几何中的截面与体积（多选）', tier: '拔高' },
    { type: 'multi', topic: '统计图表与样本数字特征（多选）', tier: '中等' },
    { type: 'fill', topic: '二项式定理与计数原理', tier: '基础' },
    { type: 'fill', topic: '导数的几何意义与切线方程', tier: '中等' },
    { type: 'fill', topic: '直线与圆的位置关系、弦长', tier: '拔高' },
    { type: 'solve', topic: '解三角形（正余弦定理与面积）', tier: '中等' },
    { type: 'solve', topic: '数列通项与求和的综合证明', tier: '中等' },
    { type: 'solve', topic: '立体几何：线面垂直证明与空间角计算', tier: '中等' },
    { type: 'solve', topic: '解析几何：椭圆与直线的综合', tier: '拔高' },
    { type: 'solve', topic: '导数：单调性、极值点偏移与不等式证明', tier: '拔高' },
];
/**
 * 高考化学卷考点骨架（18 题）。
 * 顺序即卷面顺序：单选 14 → 非选择题 4。
 */
const CHEMISTRY_SENIOR_BLUEPRINT = [
    { type: 'choice', topic: '化学与 STSE：材料、能源、环境', tier: '基础' },
    { type: 'choice', topic: '阿伏加德罗常数与微粒数目判断', tier: '基础' },
    { type: 'choice', topic: '离子共存与离子方程式正误判断', tier: '中等' },
    { type: 'choice', topic: '元素周期律与周期表推断', tier: '中等' },
    { type: 'choice', topic: '有机物的结构与同分异构体', tier: '中等' },
    { type: 'choice', topic: '电化学：原电池与电解池原理', tier: '中等' },
    { type: 'choice', topic: '化学反应速率与化学平衡移动', tier: '中等' },
    { type: 'choice', topic: '实验基本操作与装置评价', tier: '中等' },
    { type: 'choice', topic: '水溶液中的离子平衡与 pH 计算', tier: '拔高' },
    { type: 'choice', topic: '氧化还原反应与电子转移计算', tier: '中等' },
    { type: 'choice', topic: '晶体结构与晶胞计算', tier: '拔高' },
    { type: 'choice', topic: '反应热与盖斯定律', tier: '中等' },
    { type: 'choice', topic: '物质分离提纯与除杂试剂选择', tier: '中等' },
    { type: 'choice', topic: '化学平衡常数与转化率综合图象', tier: '拔高' },
    { type: 'solve', topic: '化学工艺流程：原料预处理、条件控制与产率计算', tier: '中等' },
    { type: 'solve', topic: '化学反应原理：平衡常数、速率与电化学综合', tier: '拔高' },
    { type: 'solve', topic: '物质结构与性质：电子排布、杂化与晶胞', tier: '中等' },
    { type: 'solve', topic: '有机合成与推断：官能团转化与同分异构', tier: '拔高' },
];
const BLUEPRINTS = {
    'senior-math': MATH_SENIOR_BLUEPRINT,
    'senior-chemistry': CHEMISTRY_SENIOR_BLUEPRINT,
};
/** 取该学段+学科的考点骨架；没配的返回空数组（调用方回退到自由出题）。 */
export function blueprintFor(grade, subject) {
    const spec = specFor(grade, subject);
    return BLUEPRINTS[spec.id] ?? [];
}
/** 把骨架渲染成 prompt 里的一段「逐题考点表」。 */
export function blueprintLines(slots, scores) {
    if (!slots.length)
        return [];
    const lines = ['本卷逐题考点已定死，严格按顺序出，不许换题、不许调序：'];
    slots.forEach((slot, index) => {
        const score = scores[index] ?? 0;
        lines.push(`第 ${index + 1} 题（${slot.type}，${score} 分，${slot.tier}）：${slot.topic}`);
    });
    return lines;
}
/**
 * 册别 → 章节关键词（人教版目录）。用户说「初一上册」「高一必修一」这类范围时，
 * 用这个映射把范围展开成具体章节，检索和出题都按这些章节来，做到「范围不同、卷子不同」。
 */
export const SCOPE_MAP = {
    初一上册: ['有理数', '整式的加减', '一元一次方程', '几何图形初步'],
    初一下册: ['相交线与平行线', '实数', '平面直角坐标系', '二元一次方程组', '不等式与不等式组', '数据的收集整理与描述'],
    初二上册: ['三角形', '全等三角形', '轴对称', '整式的乘法与因式分解', '分式'],
    初二下册: ['二次根式', '勾股定理', '平行四边形', '一次函数', '数据的分析'],
    初三上册: ['一元二次方程', '二次函数', '旋转', '圆', '概率初步'],
    初三下册: ['反比例函数', '相似', '锐角三角函数', '投影与视图'],
    高一必修一: ['集合', '常用逻辑用语', '一元二次函数', '函数的概念与性质', '指数函数', '对数函数', '三角函数'],
    高一必修二: ['平面向量', '复数', '立体几何初步', '统计', '概率'],
    高二选必一: ['空间向量', '直线和圆的方程', '圆锥曲线'],
    高二选必二: ['数列', '导数'],
    高二选必三: ['计数原理', '随机变量', '成对数据'],
};
/** 常见简称 → SCOPE_MAP 的规范键。用户很少完整说「高一必修一」。 */
const SCOPE_ALIAS = {
    必修一: '高一必修一',
    必修1: '高一必修一',
    必修二: '高一必修二',
    必修2: '高一必修二',
    必修三: '高二选必一',
    选必一: '高二选必一',
    选必1: '高二选必一',
    选择性必修一: '高二选必一',
    选必二: '高二选必二',
    选必2: '高二选必二',
    选择性必修二: '高二选必二',
    选必三: '高二选必三',
    选必3: '高二选必三',
    选择性必修三: '高二选必三',
    上册: '初一上册',
    下册: '初一下册',
};
/** 把用户说的范围归一成可检索的章节关键词列表。 */
export function expandScope(scope) {
    const trimmed = (scope ?? '').trim();
    if (!trimmed)
        return [];
    const direct = SCOPE_MAP[trimmed];
    if (direct)
        return direct;
    const alias = SCOPE_ALIAS[trimmed];
    if (alias && SCOPE_MAP[alias])
        return SCOPE_MAP[alias];
    // 允许「初一上册数学」这种带学科尾巴的写法，也允许「高中必修一」这种带学段的写法
    for (const key of Object.keys(SCOPE_MAP)) {
        if (trimmed.startsWith(key))
            return SCOPE_MAP[key];
    }
    for (const [short, full] of Object.entries(SCOPE_ALIAS)) {
        if (trimmed.includes(short) && SCOPE_MAP[full])
            return SCOPE_MAP[full];
    }
    return [trimmed];
}
/** 整册目录（供知识图谱在没有题库时兜底）。 */
export function scopeCatalog() {
    return Object.entries(SCOPE_MAP).map(([book, chapters]) => ({ book, chapters }));
}
