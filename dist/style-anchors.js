/**
 * 固定的「真题风格锚」。
 *
 * 甲方原话：「固定它这个流程……用大模型生成，但是固定真题风格，提前把这个东西放在这固定它。」
 * 所以这里不放题库检索结果，而是**硬编码**一小批真实卷面题，作为每次出题的固定范例：
 *   · 不依赖题库 —— 题库换成什么都不影响风格；
 *   · 不带答案 —— 只给模型看「卷面长什么样」，答案它自己算，避免抄答案抄错；
 *   · 按学科分组，同组内按顺序轮换，同一科目反复出题时范例不会永远是同一条。
 *
 * 挑题标准：题干带完整条件（数字、单位、图形关系）、问法就是卷面话（「求…的值」「则…是（　）」），
 * 不要「下列说法正确的是」这类辨析句式。
 */
const ANCHORS = [
    // ── 初中数学 ─────────────────────────────
    {
        stage: 'junior',
        subject: '数学',
        stem: '某中学在商场购买甲、乙两种不同的运动器材，购买甲种器材花费 1500 元，购买乙种器材花费 1000 元，购买甲种器材的数量是购买乙种器材数量的 2 倍，且购买一件乙种器材比购买一件甲种器材多花 10 元。(1) 求购买一件甲种器材、一件乙种器材各需多少元？(2) 该中学决定再次购买甲、乙两种运动器材共 50 件……',
    },
    {
        stage: 'junior',
        subject: '数学',
        stem: '某班开展读书活动，小明计划若干天读完一本书。如果每天读 15 页，那么比原计划多用 2 天；如果每天读 20 页，那么比原计划少用 1 天。小明原计划读（　）天。',
    },
    {
        stage: 'junior',
        subject: '数学',
        stem: '一条公路，甲队单独修需 20 天完成，乙队单独修需 30 天完成。现甲队先单独修 5 天，然后乙队加入，两队合修。乙队加入后还需（　）天完成。',
    },
    {
        stage: 'junior',
        subject: '数学',
        stem: '如图，BD 是 △ABC 的角平分线，DE⊥AB，垂足为 E，AB=6，BC=4，DE=2，则 △ABC 的面积为（　）',
    },
    {
        stage: 'junior',
        subject: '数学',
        stem: '如图，AB 为 ⊙O 的直径，C、D 为 ⊙O 上的点，AD=CD。若 ∠CAB=40°，则 ∠CAD=______。',
    },
    {
        stage: 'junior',
        subject: '数学',
        stem: '如图，已知两个同心圆，其中大圆的半径为 7，小圆的半径为 5，大圆的弦 AD 与小圆交于点 B、C，则 AB·DB 的值是______。',
    },
    {
        stage: 'junior',
        subject: '数学',
        stem: '关于 x 的一元二次方程 x²+3x+m-1=0 的两个实数根分别为 x₁、x₂。(1) 求 m 的取值范围；(2) 若 2(x₁+x₂)+x₁x₂+10=0，求 m 的值。',
    },
    {
        stage: 'junior',
        subject: '数学',
        stem: '某公司经营杨梅业务，以 3 万元/吨的价格向农户收购杨梅后，分拣成 A、B 两类，A 类包装后直接销售，B 类深加工后再销售。A 类的包装成本为 1 万元/吨，其平均销售价格 y（万元/吨）与销售数量 x（x≥2）之间的函数关系如图。(1) 直接写出 y 与 x 之间的函数关系式；',
    },
    // ── 初中物理 ─────────────────────────────
    {
        stage: 'junior',
        subject: '物理',
        stem: '用弹簧测力计挂着一个金属块，金属块浸没在水中时示数为 4 N，金属块的重力为 6 N。求金属块受到的浮力；若把金属块浸没在酒精中，弹簧测力计的示数将（选填"变大""变小"或"不变"）。',
    },
    {
        stage: 'junior',
        subject: '物理',
        stem: '某同学用图甲所示的电路探究电流与电阻的关系，电源电压恒为 3 V，定值电阻 R 分别为 5 Ω、10 Ω、15 Ω。闭合开关后，电压表的示数应保持______V 不变；当 R 由 5 Ω 换成 10 Ω 时，滑动变阻器的滑片应向______端移动。',
    },
    // ── 初中化学 ─────────────────────────────
    {
        stage: 'junior',
        subject: '化学',
        stem: '实验室用 34 g 过氧化氢溶液与 0.5 g 二氧化锰混合制取氧气，完全反应后共收集到 1.6 g 氧气。求该过氧化氢溶液中溶质的质量分数（计算结果精确到 0.1%）。',
    },
    // ── 高中数学 ─────────────────────────────
    {
        stage: 'senior',
        subject: '数学',
        stem: '已知函数 f(x)=x³-3x²+ax+1 在 x=1 处取得极值。(1) 求 a 的值；(2) 求 f(x) 在区间 [-2,3] 上的最大值与最小值。',
    },
    {
        stage: 'senior',
        subject: '数学',
        stem: '在 △ABC 中，角 A、B、C 的对边分别为 a、b、c，且 2acosB=2c-b。(1) 求角 A 的大小；(2) 若 a=√7，b+c=4，求 △ABC 的面积。',
    },
    // ── 高中物理 ─────────────────────────────
    {
        stage: 'senior',
        subject: '物理',
        stem: '质量为 2 kg 的物体静止在水平面上，物体与水平面间的动摩擦因数为 0.2。现用大小为 10 N、与水平方向成 37° 的力斜向上拉物体，g 取 10 m/s²。求物体 2 s 末的速度和 2 s 内的位移。',
    },
    // ── 高中化学 ─────────────────────────────
    {
        stage: 'senior',
        subject: '化学',
        stem: '将 5.6 g 铁粉加入 200 mL 2 mol/L 的稀硝酸中，充分反应后（假设还原产物只有 NO）。(1) 判断哪种物质过量；(2) 求标准状况下生成 NO 的体积。',
    },
];
/** 初中/高中判定：初一~初三 junior，高一~高三 senior。 */
export function stageOfGrade(grade) {
    return ['初一', '初二', '初三', '七年级', '八年级', '九年级'].some((g) => grade.includes(g.slice(0, 2)))
        ? 'junior'
        : 'senior';
}
/**
 * 取该学科的风格锚。
 * 同科目有多条时按 seed 轮换取，避免每次出题都拿同一条当范例。
 */
export function anchorsFor(subject, grade, count = 2, seed = 0) {
    const stage = stageOfGrade(grade);
    const pool = ANCHORS.filter((anchor) => anchor.subject === subject && anchor.stage === stage);
    const fallback = ANCHORS.filter((anchor) => anchor.subject === subject);
    const list = pool.length > 0 ? pool : fallback;
    if (list.length === 0)
        return [];
    const take = Math.min(count, list.length);
    const out = [];
    for (let i = 0; i < take; i += 1)
        out.push(list[(seed + i) % list.length]);
    return out;
}
/** 有没有这个学科的风格锚（没有就退回题库检索）。 */
export function hasAnchors(subject) {
    return ANCHORS.some((anchor) => anchor.subject === subject);
}
export const ANCHOR_COUNT = ANCHORS.length;
