/**
 * 知识点目录（结构化数据底座）
 *
 * 用途：参数卡「知识点目录浏览」功能的数据源。按「学科 → 年级 → 册别 → 章节 → 知识点 → 题型」
 * 组织人教版教材体系。每个知识点标注常见题型：
 *   choice=选择题 / fill=填空题 / solve=解答题 / exp=实验题。
 *
 * 数据来源：人民教育出版社教材体系（https://www.pep.com.cn/ ，教材电子版入口
 * https://jc.pep.com.cn/），结合通行的章节划分补全。仅本文件为独立新文件，
 * 不改动 cards.ts / index.ts / pdf.ts 等其它源码。
 *
 * 约定（与 parse-brief.ts 一致）：
 *   年级 grade：初一 / 初二 / 初三 / 高一 / 高二 / 高三
 *   册别 book ：初中用「上册 / 下册」；高中用「必修一 / 必修二 / 选必一 / 选必二 / 选必三」
 *   初三物理实为一册（全一册），此处按上下册拆分以统一接口。
 *   初一不开物理、初一初二不开化学，对应年级的 books 为空数组（符合课程设置）。
 */

export type QType = 'choice' | 'fill' | 'solve' | 'exp'

export interface KnowledgePoint { name: string; types: QType[] }
export interface Chapter { name: string; points: KnowledgePoint[] }
export interface Book { name: string; chapters: Chapter[] }
export interface GradeCatalog { grade: string; books: Book[] }
export interface SubjectCatalog { subject: string; grades: GradeCatalog[] }

// ——— 内部构造快捷函数：让数据声明紧凑，同时保证题型具体 ———
/** 构造知识点：未显式给题型时默认选择/填空/解答三类。 */
function p(name: string, ...types: QType[]): KnowledgePoint {
  return { name, types: types.length ? types : ['choice', 'fill', 'solve'] }
}
/** 构造章节。 */
function ch(name: string, ...points: KnowledgePoint[]): Chapter {
  return { name, points }
}

// ============================================================
// 数学
// ============================================================

const M_Q7S: Chapter[] = [
  ch('第1章 有理数',
    p('正数与负数', 'choice', 'fill'),
    p('有理数的概念与分类', 'choice', 'fill'),
    p('数轴与相反数', 'choice', 'fill'),
    p('绝对值与有理数大小比较', 'choice', 'fill', 'solve'),
    p('有理数的加减法', 'choice', 'fill', 'solve'),
    p('有理数的乘除法', 'choice', 'fill', 'solve'),
    p('有理数的乘方', 'choice', 'fill', 'solve'),
    p('科学记数法与近似数', 'choice', 'fill')),
  ch('第2章 整式的加减',
    p('单项式与多项式', 'choice', 'fill'),
    p('整式的概念', 'choice', 'fill'),
    p('合并同类项', 'choice', 'fill', 'solve'),
    p('去括号与添括号', 'choice', 'fill', 'solve'),
    p('整式的加减运算', 'choice', 'fill', 'solve')),
  ch('第3章 一元一次方程',
    p('方程与方程的解', 'choice', 'fill'),
    p('等式的基本性质', 'choice', 'fill'),
    p('解一元一次方程（去分母、去括号）', 'choice', 'fill', 'solve'),
    p('一元一次方程的应用（行程、工程、利润）', 'solve')),
  ch('第4章 几何图形初步',
    p('立体图形与平面图形', 'choice', 'fill'),
    p('直线、射线与线段', 'choice', 'fill'),
    p('线段的中点与比较', 'choice', 'fill', 'solve'),
    p('角的概念与度量', 'choice', 'fill'),
    p('角平分线与余角、补角', 'choice', 'fill', 'solve')),
]

const M_Q7X: Chapter[] = [
  ch('第5章 相交线与平行线',
    p('对顶角与邻补角', 'choice', 'fill'),
    p('垂线及点到直线的距离', 'choice', 'fill', 'solve'),
    p('平行线的判定', 'choice', 'fill', 'solve'),
    p('平行线的性质', 'choice', 'fill', 'solve'),
    p('命题、定理与平移', 'choice', 'fill')),
  ch('第6章 实数',
    p('平方根与算术平方根', 'choice', 'fill', 'solve'),
    p('立方根', 'choice', 'fill', 'solve'),
    p('实数的概念与运算', 'choice', 'fill', 'solve'),
    p('无理数与数轴', 'choice', 'fill')),
  ch('第7章 平面直角坐标系',
    p('有序数对', 'choice', 'fill'),
    p('平面直角坐标系与点的坐标', 'choice', 'fill'),
    p('坐标与图形（平移、面积）', 'choice', 'fill', 'solve')),
  ch('第8章 二元一次方程组',
    p('二元一次方程组及其解', 'choice', 'fill'),
    p('代入消元法', 'choice', 'fill', 'solve'),
    p('加减消元法', 'choice', 'fill', 'solve'),
    p('二元一次方程组的应用', 'solve')),
  ch('第9章 不等式',
    p('不等式及其性质', 'choice', 'fill'),
    p('解一元一次不等式', 'choice', 'fill', 'solve'),
    p('解一元一次不等式组', 'choice', 'fill', 'solve'),
    p('不等式的应用（方案选择）', 'solve')),
  ch('第10章 数据的收集、整理与描述',
    p('统计调查与抽样', 'choice', 'fill'),
    p('条形图、扇形图、折线图', 'choice', 'fill', 'solve'),
    p('直方图', 'choice', 'fill', 'solve')),
]

const M_Q8S: Chapter[] = [
  ch('第11章 三角形',
    p('三角形的三边关系', 'choice', 'fill', 'solve'),
    p('三角形的内角和与外角', 'choice', 'fill', 'solve'),
    p('三角形的高、中线、角平分线', 'choice', 'fill'),
    p('多边形的对角线与内角和', 'choice', 'fill', 'solve')),
  ch('第12章 全等三角形',
    p('全等三角形的性质', 'choice', 'fill', 'solve'),
    p('全等判定：SSS 与 SAS', 'choice', 'fill', 'solve'),
    p('全等判定：ASA 与 AAS', 'choice', 'fill', 'solve'),
    p('全等判定：HL（直角三角形）', 'choice', 'fill', 'solve'),
    p('角平分线的性质与判定', 'choice', 'fill', 'solve')),
  ch('第13章 轴对称',
    p('轴对称与轴对称图形', 'choice', 'fill'),
    p('线段垂直平分线', 'choice', 'fill', 'solve'),
    p('等腰三角形的性质与判定', 'choice', 'fill', 'solve'),
    p('等边三角形与含30°角的直角三角形', 'choice', 'fill', 'solve')),
  ch('第14章 整式的乘法与因式分解',
    p('同底数幂的乘除、幂的乘方与积的乘方', 'choice', 'fill', 'solve'),
    p('整式的乘法', 'choice', 'fill', 'solve'),
    p('乘法公式（平方差、完全平方）', 'choice', 'fill', 'solve'),
    p('因式分解：提公因式法', 'choice', 'fill', 'solve'),
    p('因式分解：公式法', 'choice', 'fill', 'solve')),
  ch('第15章 分式',
    p('分式的概念与基本性质', 'choice', 'fill'),
    p('分式的乘除运算', 'choice', 'fill', 'solve'),
    p('分式的加减运算', 'choice', 'fill', 'solve'),
    p('分式方程及其解法', 'choice', 'fill', 'solve'),
    p('分式方程的应用', 'solve')),
]

const M_Q8X: Chapter[] = [
  ch('第16章 二次根式',
    p('二次根式的概念与有意义条件', 'choice', 'fill'),
    p('二次根式的性质', 'choice', 'fill', 'solve'),
    p('二次根式的乘除运算', 'choice', 'fill', 'solve'),
    p('二次根式的加减运算', 'choice', 'fill', 'solve')),
  ch('第17章 勾股定理',
    p('勾股定理及其证明', 'choice', 'fill', 'solve'),
    p('勾股定理的逆定理', 'choice', 'fill', 'solve'),
    p('勾股定理的应用（实际测量）', 'solve')),
  ch('第18章 平行四边形',
    p('平行四边形的性质', 'choice', 'fill', 'solve'),
    p('平行四边形的判定', 'choice', 'fill', 'solve'),
    p('矩形及其性质与判定', 'choice', 'fill', 'solve'),
    p('菱形及其性质与判定', 'choice', 'fill', 'solve'),
    p('正方形的性质与判定', 'choice', 'fill', 'solve'),
    p('三角形中位线', 'choice', 'fill', 'solve')),
  ch('第19章 一次函数',
    p('函数的概念与图象', 'choice', 'fill'),
    p('正比例函数', 'choice', 'fill', 'solve'),
    p('一次函数的图象与性质', 'choice', 'fill', 'solve'),
    p('待定系数法求解析式', 'choice', 'fill', 'solve'),
    p('一次函数与方程、不等式', 'choice', 'fill', 'solve'),
    p('一次函数的应用（实际问题）', 'solve')),
  ch('第20章 数据的分析',
    p('平均数（含加权平均数）', 'choice', 'fill', 'solve'),
    p('中位数与众数', 'choice', 'fill', 'solve'),
    p('极差与方差', 'choice', 'fill', 'solve'),
    p('数据的分析与应用', 'solve')),
]

const M_Q9S: Chapter[] = [
  ch('第21章 一元二次方程',
    p('一元二次方程及其一般形式', 'choice', 'fill'),
    p('配方法解方程', 'choice', 'fill', 'solve'),
    p('公式法与根的判别式', 'choice', 'fill', 'solve'),
    p('因式分解法解方程', 'choice', 'fill', 'solve'),
    p('根与系数的关系（韦达定理）', 'choice', 'fill', 'solve'),
    p('一元二次方程的应用（增长、面积）', 'solve')),
  ch('第22章 二次函数',
    p('二次函数的概念与图象', 'choice', 'fill'),
    p('二次函数 y=ax²+bx+c 的图象与性质', 'choice', 'fill', 'solve'),
    p('二次函数的图象平移与对称', 'choice', 'fill', 'solve'),
    p('待定系数法求二次函数解析式', 'choice', 'fill', 'solve'),
    p('二次函数与一元二次方程', 'choice', 'fill', 'solve'),
    p('二次函数的应用（最值问题）', 'solve')),
  ch('第23章 旋转',
    p('旋转及其性质', 'choice', 'fill', 'solve'),
    p('中心对称与中心对称图形', 'choice', 'fill'),
    p('关于原点对称的点的坐标', 'choice', 'fill', 'solve'),
    p('旋转全等模型应用', 'solve')),
  ch('第24章 圆',
    p('圆的相关概念与垂径定理', 'choice', 'fill', 'solve'),
    p('弧、弦、圆心角的关系', 'choice', 'fill', 'solve'),
    p('圆周角定理及其推论', 'choice', 'fill', 'solve'),
    p('点与圆、直线与圆的位置关系', 'choice', 'fill', 'solve'),
    p('切线的性质与判定', 'choice', 'fill', 'solve'),
    p('切线长定理与内切圆', 'choice', 'fill', 'solve'),
    p('正多边形和圆', 'choice', 'fill'),
    p('弧长与扇形面积', 'choice', 'fill', 'solve')),
  ch('第25章 概率初步',
    p('随机事件与概率', 'choice', 'fill'),
    p('古典概型与列举法（列表、树状图）', 'choice', 'fill', 'solve'),
    p('用频率估计概率', 'choice', 'fill', 'solve')),
]

const M_Q9X: Chapter[] = [
  ch('第26章 反比例函数',
    p('反比例函数的概念', 'choice', 'fill'),
    p('反比例函数的图象与性质', 'choice', 'fill', 'solve'),
    p('反比例函数 k 的几何意义', 'choice', 'fill', 'solve'),
    p('反比例函数的应用', 'solve')),
  ch('第27章 相似',
    p('相似图形与成比例线段', 'choice', 'fill'),
    p('平行线分线段成比例', 'choice', 'fill', 'solve'),
    p('相似三角形的判定', 'choice', 'fill', 'solve'),
    p('相似三角形的性质', 'choice', 'fill', 'solve'),
    p('位似', 'choice', 'fill', 'solve'),
    p('相似模型应用（测高、影长）', 'solve')),
  ch('第28章 锐角三角函数',
    p('正弦、余弦、正切的定义', 'choice', 'fill', 'solve'),
    p('特殊角的三角函数值', 'choice', 'fill', 'solve'),
    p('解直角三角形', 'choice', 'fill', 'solve'),
    p('锐角三角函数的实际应用（测高、坡度）', 'solve')),
  ch('第29章 投影与视图',
    p('平行投影与中心投影', 'choice', 'fill'),
    p('三视图（主视图、左视图、俯视图）', 'choice', 'fill'),
    p('由三视图还原几何体', 'choice', 'fill', 'solve')),
]

const M_B1: Chapter[] = [
  ch('第1章 集合与常用逻辑用语',
    p('集合的概念与表示', 'choice', 'fill'),
    p('集合间的基本关系', 'choice', 'fill', 'solve'),
    p('集合的基本运算（交、并、补）', 'choice', 'fill', 'solve'),
    p('充分条件与必要条件', 'choice', 'fill', 'solve'),
    p('全称量词与存在量词及其否定', 'choice', 'fill', 'solve')),
  ch('第2章 一元二次函数、方程和不等式',
    p('等式性质与不等式性质', 'choice', 'fill'),
    p('基本不等式及其应用', 'choice', 'fill', 'solve'),
    p('二次函数与一元二次方程、不等式', 'choice', 'fill', 'solve')),
  ch('第3章 函数的概念与性质',
    p('函数的概念及其表示', 'choice', 'fill'),
    p('函数的单调性', 'choice', 'fill', 'solve'),
    p('函数的奇偶性', 'choice', 'fill', 'solve'),
    p('幂函数', 'choice', 'fill', 'solve'),
    p('函数的最值', 'choice', 'fill', 'solve')),
  ch('第4章 指数函数与对数函数',
    p('指数与指数幂的运算', 'choice', 'fill', 'solve'),
    p('指数函数的图象与性质', 'choice', 'fill', 'solve'),
    p('对数的概念与运算', 'choice', 'fill', 'solve'),
    p('对数函数的图象与性质', 'choice', 'fill', 'solve'),
    p('函数的应用（零点、二分法、函数模型）', 'choice', 'fill', 'solve')),
  ch('第5章 三角函数',
    p('任意角与弧度制', 'choice', 'fill'),
    p('任意角的三角函数', 'choice', 'fill', 'solve'),
    p('同角三角函数基本关系与诱导公式', 'choice', 'fill', 'solve'),
    p('正弦、余弦函数的图象与性质', 'choice', 'fill', 'solve'),
    p('两角和差与二倍角公式', 'choice', 'fill', 'solve'),
    p('三角函数模型的简单应用', 'solve')),
]

const M_B2: Chapter[] = [
  ch('第6章 平面向量及其应用',
    p('平面向量的概念与线性运算', 'choice', 'fill', 'solve'),
    p('平面向量基本定理与坐标表示', 'choice', 'fill', 'solve'),
    p('平面向量的数量积', 'choice', 'fill', 'solve'),
    p('正弦定理与余弦定理（解三角形）', 'choice', 'fill', 'solve'),
    p('解三角形的实际应用', 'solve')),
  ch('第7章 复数',
    p('复数的概念与几何意义', 'choice', 'fill'),
    p('复数的四则运算', 'choice', 'fill', 'solve')),
  ch('第8章 立体几何初步',
    p('基本立体图形与直观图', 'choice', 'fill'),
    p('简单几何体的表面积与体积', 'choice', 'fill', 'solve'),
    p('空间点、直线、平面的位置关系', 'choice', 'fill', 'solve'),
    p('空间直线、平面的平行', 'choice', 'fill', 'solve'),
    p('空间直线、平面的垂直', 'choice', 'fill', 'solve')),
  ch('第9章 统计',
    p('随机抽样（简单随机、分层）', 'choice', 'fill', 'solve'),
    p('用样本估计总体（频率分布、统计量）', 'choice', 'fill', 'solve'),
    p('统计案例与数据分析', 'choice', 'fill', 'solve')),
  ch('第10章 概率',
    p('随机事件与概率', 'choice', 'fill'),
    p('古典概型', 'choice', 'fill', 'solve'),
    p('事件的相互独立性', 'choice', 'fill', 'solve'),
    p('频率与概率（模拟）', 'choice', 'fill', 'solve')),
]

const M_X1: Chapter[] = [
  ch('第1章 空间向量与立体几何',
    p('空间向量及其运算', 'choice', 'fill', 'solve'),
    p('空间向量基本定理与坐标运算', 'choice', 'fill', 'solve'),
    p('用空间向量求空间角（线面角、二面角）', 'choice', 'fill', 'solve'),
    p('用空间向量求距离与证明平行垂直', 'solve')),
  ch('第2章 直线及其方程',
    p('直线的倾斜角与斜率', 'choice', 'fill'),
    p('直线的方程（点斜式、斜截式、一般式）', 'choice', 'fill', 'solve'),
    p('两条直线的位置关系与距离公式', 'choice', 'fill', 'solve'),
    p('直线的综合应用', 'solve')),
  ch('第3章 圆锥曲线的方程',
    p('椭圆及其标准方程与性质', 'choice', 'fill', 'solve'),
    p('双曲线及其标准方程与性质', 'choice', 'fill', 'solve'),
    p('抛物线及其标准方程与性质', 'choice', 'fill', 'solve'),
    p('直线与圆锥曲线的位置关系', 'solve')),
]

const M_X2: Chapter[] = [
  ch('第1章 数列',
    p('数列的概念与通项公式', 'choice', 'fill', 'solve'),
    p('等差数列及其前 n 项和', 'choice', 'fill', 'solve'),
    p('等比数列及其前 n 项和', 'choice', 'fill', 'solve'),
    p('数列求和的常用方法（裂项、错位相减）', 'solve'),
    p('数列的综合应用', 'solve')),
  ch('第2章 一元函数导数及其应用',
    p('导数的概念与几何意义', 'choice', 'fill', 'solve'),
    p('导数的运算（求导法则）', 'choice', 'fill', 'solve'),
    p('导数与函数的单调性、极值、最值', 'choice', 'fill', 'solve'),
    p('导数的实际应用（优化问题）', 'solve')),
]

const M_X3: Chapter[] = [
  ch('第1章 计数原理',
    p('分类加法与分步乘法计数原理', 'choice', 'fill', 'solve'),
    p('排列与排列数', 'choice', 'fill', 'solve'),
    p('组合与组合数', 'choice', 'fill', 'solve'),
    p('二项式定理与二项式系数', 'choice', 'fill', 'solve')),
  ch('第2章 随机变量及其分布',
    p('随机变量与分布列', 'choice', 'fill', 'solve'),
    p('期望与方差', 'choice', 'fill', 'solve'),
    p('二项分布与超几何分布', 'choice', 'fill', 'solve'),
    p('正态分布', 'choice', 'fill', 'solve')),
  ch('第3章 成对数据统计分析',
    p('成对数据相关性与相关系数', 'choice', 'fill', 'solve'),
    p('一元线性回归模型', 'choice', 'fill', 'solve'),
    p('独立性检验', 'choice', 'fill', 'solve')),
]

// ============================================================
// 物理
// ============================================================

const P_Q8S: Chapter[] = [
  ch('第1章 机械运动',
    p('长度和时间的测量', 'choice', 'fill', 'exp'),
    p('运动的描述（参照物）', 'choice', 'fill'),
    p('运动的快慢（速度）', 'choice', 'fill', 'solve'),
    p('测量平均速度', 'choice', 'fill', 'solve', 'exp')),
  ch('第2章 声现象',
    p('声音的产生与传播', 'choice', 'fill'),
    p('声音的特性（音调、响度、音色）', 'choice', 'fill'),
    p('声的利用', 'choice', 'fill'),
    p('噪声的危害和控制', 'choice', 'fill')),
  ch('第3章 物态变化',
    p('温度与温度计的使用', 'choice', 'fill', 'exp'),
    p('熔化和凝固', 'choice', 'fill', 'solve'),
    p('汽化和液化', 'choice', 'fill', 'solve'),
    p('升华和凝华', 'choice', 'fill')),
  ch('第4章 光现象',
    p('光的直线传播', 'choice', 'fill'),
    p('光的反射与反射定律', 'choice', 'fill', 'solve', 'exp'),
    p('平面镜成像', 'choice', 'fill', 'solve', 'exp'),
    p('光的折射', 'choice', 'fill', 'solve'),
    p('光的色散与看不见的光', 'choice', 'fill')),
  ch('第5章 透镜及其应用',
    p('透镜（凸透镜、凹透镜）', 'choice', 'fill'),
    p('凸透镜成像规律', 'choice', 'fill', 'solve', 'exp'),
    p('生活中的透镜（照相机、投影仪、放大镜）', 'choice', 'fill'),
    p('眼睛和眼镜', 'choice', 'fill'),
    p('显微镜和望远镜', 'choice', 'fill')),
  ch('第6章 质量与密度',
    p('质量及其测量', 'choice', 'fill', 'exp'),
    p('密度的概念与计算', 'choice', 'fill', 'solve'),
    p('密度的测量', 'choice', 'fill', 'solve', 'exp'),
    p('密度的应用', 'choice', 'fill', 'solve')),
]

const P_Q8X: Chapter[] = [
  ch('第7章 力',
    p('力的概念与力的作用效果', 'choice', 'fill'),
    p('弹力与弹簧测力计', 'choice', 'fill', 'exp'),
    p('重力', 'choice', 'fill', 'solve')),
  ch('第8章 运动和力',
    p('牛顿第一定律与惯性', 'choice', 'fill'),
    p('二力平衡', 'choice', 'fill', 'solve'),
    p('摩擦力（滑动、静摩擦）', 'choice', 'fill', 'solve', 'exp')),
  ch('第9章 压强',
    p('压强及其计算', 'choice', 'fill', 'solve'),
    p('液体的压强', 'choice', 'fill', 'solve'),
    p('大气压强', 'choice', 'fill', 'exp'),
    p('流体压强与流速的关系', 'choice', 'fill')),
  ch('第10章 浮力',
    p('浮力及其产生原因', 'choice', 'fill'),
    p('阿基米德原理', 'choice', 'fill', 'solve', 'exp'),
    p('物体的浮沉条件及应用', 'choice', 'fill', 'solve')),
  ch('第11章 功和机械能',
    p('功及其计算', 'choice', 'fill', 'solve'),
    p('功率', 'choice', 'fill', 'solve'),
    p('动能和势能', 'choice', 'fill'),
    p('机械能及其转化', 'choice', 'fill', 'solve')),
  ch('第12章 简单机械',
    p('杠杆及其平衡条件', 'choice', 'fill', 'solve', 'exp'),
    p('滑轮与滑轮组', 'choice', 'fill', 'solve'),
    p('机械效率', 'choice', 'fill', 'solve', 'exp')),
]

const P_Q9S: Chapter[] = [
  ch('第13章 内能',
    p('分子热运动', 'choice', 'fill'),
    p('内能及其改变方式', 'choice', 'fill'),
    p('比热容与热量计算', 'choice', 'fill', 'solve', 'exp')),
  ch('第14章 内能的利用',
    p('热机与内燃机', 'choice', 'fill'),
    p('热机的效率', 'choice', 'fill', 'solve'),
    p('能量守恒定律', 'choice', 'fill')),
  ch('第15章 电流和电路',
    p('两种电荷与电荷间作用', 'choice', 'fill'),
    p('电流、电路与电路图', 'choice', 'fill'),
    p('串联电路与并联电路', 'choice', 'fill', 'exp'),
    p('电流的测量', 'choice', 'fill', 'exp'),
    p('串、并联电路中电流的规律', 'choice', 'fill', 'solve', 'exp')),
  ch('第16章 电压 电阻',
    p('电压及其测量', 'choice', 'fill', 'exp'),
    p('串、并联电路中电压的规律', 'choice', 'fill', 'solve', 'exp'),
    p('电阻及其影响因素', 'choice', 'fill'),
    p('变阻器（滑动变阻器）', 'choice', 'fill', 'exp')),
  ch('第17章 欧姆定律',
    p('探究电流与电压、电阻的关系', 'choice', 'fill', 'solve', 'exp'),
    p('欧姆定律及其应用', 'choice', 'fill', 'solve'),
    p('电阻的测量（伏安法）', 'choice', 'fill', 'solve', 'exp'),
    p('串、并联电路的电阻计算', 'choice', 'fill', 'solve')),
  ch('第18章 电功率',
    p('电能与电功', 'choice', 'fill', 'solve'),
    p('电功率及其计算', 'choice', 'fill', 'solve'),
    p('测量小灯泡的电功率', 'choice', 'fill', 'solve', 'exp'),
    p('焦耳定律与电热', 'choice', 'fill', 'solve')),
]

const P_Q9X: Chapter[] = [
  ch('第19章 生活用电',
    p('家庭电路的组成', 'choice', 'fill'),
    p('家庭电路中电流过大的原因', 'choice', 'fill', 'solve'),
    p('安全用电常识', 'choice', 'fill')),
  ch('第20章 电与磁',
    p('磁现象与磁场', 'choice', 'fill'),
    p('电生磁（奥斯特实验、安培定则）', 'choice', 'fill', 'exp'),
    p('电磁铁与电磁继电器', 'choice', 'fill'),
    p('磁场对通电导线的作用与电动机', 'choice', 'fill'),
    p('磁生电与发电机（电磁感应）', 'choice', 'fill', 'exp')),
  ch('第21章 信息的传递',
    p('电话与通信', 'choice', 'fill'),
    p('电磁波及其应用', 'choice', 'fill'),
    p('广播、电视和移动通信', 'choice', 'fill')),
  ch('第22章 能源与可持续发展',
    p('能源与能源分类', 'choice', 'fill'),
    p('核能与太阳能', 'choice', 'fill'),
    p('能源与可持续发展', 'choice', 'fill')),
]

const P_B1: Chapter[] = [
  ch('第1章 运动的描述',
    p('质点、参考系与空间位置', 'choice', 'fill'),
    p('时间与位移', 'choice', 'fill', 'solve'),
    p('速度（平均速度与瞬时速度）', 'choice', 'fill', 'solve'),
    p('加速度', 'choice', 'fill', 'solve')),
  ch('第2章 匀变速直线运动的研究',
    p('实验：探究小车速度随时间变化的规律', 'choice', 'fill', 'solve', 'exp'),
    p('匀变速直线运动的速度与时间关系', 'choice', 'fill', 'solve'),
    p('匀变速直线运动的位移与时间关系', 'choice', 'fill', 'solve'),
    p('自由落体运动', 'choice', 'fill', 'solve')),
  ch('第3章 相互作用——力',
    p('重力与弹力', 'choice', 'fill', 'solve'),
    p('摩擦力（滑动、静摩擦）', 'choice', 'fill', 'solve'),
    p('牛顿第三定律', 'choice', 'fill'),
    p('力的合成与分解', 'choice', 'fill', 'solve', 'exp')),
  ch('第4章 运动和力的关系',
    p('牛顿第一定律', 'choice', 'fill'),
    p('实验：探究加速度与力、质量的关系', 'choice', 'fill', 'solve', 'exp'),
    p('牛顿第二定律', 'choice', 'fill', 'solve'),
    p('力学单位制', 'choice', 'fill'),
    p('超重与失重', 'choice', 'fill', 'solve')),
]

const P_B2: Chapter[] = [
  ch('第5章 曲线运动',
    p('曲线运动的条件与特点', 'choice', 'fill'),
    p('平抛运动', 'choice', 'fill', 'solve', 'exp'),
    p('圆周运动（线速度、角速度、向心加速度）', 'choice', 'fill', 'solve'),
    p('向心力与圆周运动应用', 'choice', 'fill', 'solve')),
  ch('第6章 万有引力与宇宙航行',
    p('行星运动与开普勒定律', 'choice', 'fill'),
    p('万有引力定律', 'choice', 'fill', 'solve'),
    p('万有引力理论的成就（称量地球、发现海王星）', 'choice', 'fill', 'solve'),
    p('宇宙航行与卫星', 'choice', 'fill', 'solve')),
  ch('第7章 机械能守恒定律',
    p('功与功率', 'choice', 'fill', 'solve'),
    p('重力势能与弹性势能', 'choice', 'fill', 'solve'),
    p('动能和动能定理', 'choice', 'fill', 'solve'),
    p('机械能守恒定律', 'choice', 'fill', 'solve', 'exp'),
    p('能量守恒定律与能源', 'choice', 'fill')),
]

const P_X1: Chapter[] = [
  ch('第1章 动量守恒定律',
    p('动量与冲量', 'choice', 'fill', 'solve'),
    p('动量定理', 'choice', 'fill', 'solve'),
    p('动量守恒定律', 'choice', 'fill', 'solve'),
    p('碰撞与反冲', 'choice', 'fill', 'solve', 'exp')),
  ch('第2章 机械振动',
    p('简谐运动及其图象', 'choice', 'fill', 'solve'),
    p('简谐运动的回复力与能量', 'choice', 'fill', 'solve'),
    p('单摆与周期公式', 'choice', 'fill', 'solve', 'exp'),
    p('受迫振动与共振', 'choice', 'fill')),
  ch('第3章 机械波',
    p('波的形成与传播', 'choice', 'fill'),
    p('波的描述（波长、频率、波速）', 'choice', 'fill', 'solve'),
    p('波的反射、折射、衍射与干涉', 'choice', 'fill', 'solve'),
    p('多普勒效应', 'choice', 'fill')),
  ch('第4章 光',
    p('光的折射与折射率', 'choice', 'fill', 'solve', 'exp'),
    p('全反射', 'choice', 'fill', 'solve'),
    p('光的干涉与衍射', 'choice', 'fill'),
    p('光的偏振与激光', 'choice', 'fill')),
  ch('第5章 电磁波',
    p('电磁振荡与 LC 回路', 'choice', 'fill'),
    p('电磁波的产生、发射与接收', 'choice', 'fill')),
]

const P_X2: Chapter[] = [
  ch('第1章 静电场',
    p('电荷与库仑定律', 'choice', 'fill', 'solve'),
    p('电场强度与电场线', 'choice', 'fill', 'solve'),
    p('电势能、电势与电势差', 'choice', 'fill', 'solve'),
    p('电容器与电容', 'choice', 'fill', 'solve'),
    p('带电粒子在电场中的运动', 'choice', 'fill', 'solve')),
  ch('第2章 电路及其应用',
    p('电源、电流与电动势', 'choice', 'fill'),
    p('闭合电路欧姆定律', 'choice', 'fill', 'solve'),
    p('多用电表的使用', 'choice', 'fill', 'exp'),
    p('测量金属丝的电阻率', 'choice', 'fill', 'solve', 'exp')),
  ch('第3章 磁场',
    p('磁感应强度与磁感线', 'choice', 'fill'),
    p('磁场对通电导线的作用（安培力）', 'choice', 'fill', 'solve'),
    p('磁场对运动电荷的作用（洛伦兹力）', 'choice', 'fill', 'solve'),
    p('带电粒子在匀强磁场中的运动', 'choice', 'fill', 'solve')),
  ch('第4章 电磁感应',
    p('楞次定律', 'choice', 'fill', 'solve'),
    p('法拉第电磁感应定律', 'choice', 'fill', 'solve'),
    p('涡流、电磁阻尼与电磁驱动', 'choice', 'fill'),
    p('互感和自感', 'choice', 'fill')),
  ch('第5章 交变电流',
    p('交变电流的产生与描述', 'choice', 'fill', 'solve'),
    p('变压器', 'choice', 'fill', 'solve'),
    p('远距离输电', 'choice', 'fill', 'solve')),
]

const P_X3: Chapter[] = [
  ch('第1章 分子动理论',
    p('分子动理论的基本内容', 'choice', 'fill'),
    p('内能', 'choice', 'fill', 'solve'),
    p('热力学定律', 'choice', 'fill', 'solve')),
  ch('第2章 气体、固体和液体',
    p('气体实验定律', 'choice', 'fill', 'solve'),
    p('理想气体状态方程', 'choice', 'fill', 'solve'),
    p('固体和液体的性质', 'choice', 'fill')),
  ch('第3章 原子结构',
    p('电子的发现与原子的核式结构', 'choice', 'fill'),
    p('玻尔原子理论与能级跃迁', 'choice', 'fill', 'solve'),
    p('氢原子光谱', 'choice', 'fill')),
  ch('第4章 原子核',
    p('原子核的组成与核反应方程', 'choice', 'fill', 'solve'),
    p('放射性元素的衰变', 'choice', 'fill', 'solve'),
    p('结合能与质量亏损', 'choice', 'fill', 'solve'),
    p('核裂变与核聚变', 'choice', 'fill')),
]

// ============================================================
// 化学
// ============================================================

const C_Q9S: Chapter[] = [
  ch('第1章 走进化学世界',
    p('化学是什么', 'choice', 'fill'),
    p('物质的变化和性质', 'choice', 'fill'),
    p('化学实验基本操作（加热、取用、洗涤）', 'choice', 'fill', 'exp')),
  ch('第2章 我们周围的空气',
    p('空气的组成与保护', 'choice', 'fill'),
    p('氧气的性质', 'choice', 'fill', 'solve', 'exp'),
    p('氧气的实验室制取', 'choice', 'fill', 'solve', 'exp')),
  ch('第3章 物质构成的奥秘',
    p('分子和原子', 'choice', 'fill'),
    p('原子的结构', 'choice', 'fill'),
    p('元素与元素符号', 'choice', 'fill'),
    p('离子与离子符号', 'choice', 'fill')),
  ch('第4章 自然界的水',
    p('爱护水资源与水污染', 'choice', 'fill'),
    p('水的净化（沉淀、过滤、吸附、蒸馏）', 'choice', 'fill', 'exp'),
    p('水的组成（电解水实验）', 'choice', 'fill', 'solve', 'exp'),
    p('化学式与化合价', 'choice', 'fill', 'solve')),
  ch('第5章 化学方程式',
    p('质量守恒定律', 'choice', 'fill', 'solve', 'exp'),
    p('化学方程式的书写与配平', 'choice', 'fill', 'solve'),
    p('根据化学方程式的计算', 'choice', 'fill', 'solve')),
  ch('第6章 碳和碳的氧化物',
    p('金刚石、石墨和 C60', 'choice', 'fill'),
    p('二氧化碳的实验室制取', 'choice', 'fill', 'solve', 'exp'),
    p('二氧化碳的性质与用途', 'choice', 'fill', 'solve', 'exp'),
    p('一氧化碳的性质与毒性', 'choice', 'fill', 'solve')),
  ch('第7章 燃料及其利用',
    p('燃烧的条件与灭火原理', 'choice', 'fill', 'exp'),
    p('化石燃料及其利用', 'choice', 'fill'),
    p('使用燃料对环境的影响', 'choice', 'fill')),
]

const C_Q9X: Chapter[] = [
  ch('第8章 金属和金属材料',
    p('金属材料的性质与用途', 'choice', 'fill'),
    p('金属的化学性质', 'choice', 'fill', 'solve', 'exp'),
    p('金属活动性顺序', 'choice', 'fill', 'solve'),
    p('金属资源的利用与保护', 'choice', 'fill')),
  ch('第9章 溶液',
    p('溶液的形成与组成', 'choice', 'fill'),
    p('溶解度与溶解度曲线', 'choice', 'fill', 'solve'),
    p('溶质质量分数及其计算', 'choice', 'fill', 'solve', 'exp'),
    p('一定溶质质量分数溶液的配制', 'choice', 'fill', 'solve', 'exp')),
  ch('第10章 酸和碱',
    p('常见的酸及其性质', 'choice', 'fill', 'solve', 'exp'),
    p('常见的碱及其性质', 'choice', 'fill', 'solve', 'exp'),
    p('酸碱中和反应', 'choice', 'fill', 'solve', 'exp'),
    p('溶液的酸碱性与 pH', 'choice', 'fill', 'exp')),
  ch('第11章 盐 化肥',
    p('常见的盐及其用途', 'choice', 'fill'),
    p('盐的化学性质', 'choice', 'fill', 'solve', 'exp'),
    p('复分解反应及其发生条件', 'choice', 'fill', 'solve'),
    p('化学肥料', 'choice', 'fill')),
  ch('第12章 化学与生活',
    p('人类重要的营养物质', 'choice', 'fill'),
    p('化学元素与人体健康', 'choice', 'fill'),
    p('有机合成材料', 'choice', 'fill')),
]

const C_B1: Chapter[] = [
  ch('第1章 物质的分类及转化',
    p('物质的分类（树状、交叉分类）', 'choice', 'fill'),
    p('分散系及其分类（胶体）', 'choice', 'fill'),
    p('物质的转化与化学反应类型', 'choice', 'fill', 'solve')),
  ch('第2章 离子反应',
    p('电解质的电离', 'choice', 'fill', 'solve'),
    p('离子反应及其发生条件', 'choice', 'fill', 'solve'),
    p('离子方程式的书写与正误判断', 'choice', 'fill', 'solve'),
    p('离子共存与离子检验', 'choice', 'fill', 'solve')),
  ch('第3章 氧化还原反应',
    p('氧化还原反应的基本概念', 'choice', 'fill'),
    p('氧化剂与还原剂、氧化性与还原性', 'choice', 'fill', 'solve'),
    p('氧化还原反应的配平', 'choice', 'fill', 'solve'),
    p('氧化还原反应的计算（电子守恒）', 'choice', 'fill', 'solve')),
  ch('第4章 钠及其化合物',
    p('钠的性质', 'choice', 'fill', 'solve', 'exp'),
    p('钠的氧化物（氧化钠、过氧化钠）', 'choice', 'fill', 'solve'),
    p('碳酸钠与碳酸氢钠', 'choice', 'fill', 'solve', 'exp'),
    p('焰色试验', 'choice', 'fill', 'exp')),
  ch('第5章 氯及其化合物',
    p('氯气的性质', 'choice', 'fill', 'solve', 'exp'),
    p('氯气的实验室制法', 'choice', 'fill', 'solve', 'exp'),
    p('氯离子的检验', 'choice', 'fill', 'exp'),
    p('卤族元素及其递变规律', 'choice', 'fill', 'solve')),
  ch('第6章 物质的量',
    p('物质的量的单位——摩尔', 'choice', 'fill', 'solve'),
    p('摩尔质量', 'choice', 'fill', 'solve'),
    p('气体摩尔体积', 'choice', 'fill', 'solve'),
    p('物质的量浓度', 'choice', 'fill', 'solve'),
    p('一定物质的量浓度溶液的配制', 'choice', 'fill', 'solve', 'exp')),
]

const C_B2: Chapter[] = [
  ch('第1章 物质结构 元素周期律',
    p('原子结构与元素周期表', 'choice', 'fill'),
    p('元素周期律（半径、金属性、非金属性）', 'choice', 'fill', 'solve'),
    p('化学键（离子键、共价键）', 'choice', 'fill', 'solve'),
    p('元素周期律的综合应用', 'choice', 'fill', 'solve')),
  ch('第2章 化学反应与能量',
    p('化学反应中的能量变化', 'choice', 'fill'),
    p('化学反应的速率与限度', 'choice', 'fill', 'solve'),
    p('原电池的工作原理', 'choice', 'fill', 'solve', 'exp')),
  ch('第3章 简单的有机化合物',
    p('甲烷与烷烃', 'choice', 'fill', 'solve'),
    p('乙烯与烯烃', 'choice', 'fill', 'solve'),
    p('乙醇与乙酸', 'choice', 'fill', 'solve', 'exp'),
    p('糖类、油脂和蛋白质', 'choice', 'fill')),
  ch('第4章 化学与可持续发展',
    p('自然资源的开发利用', 'choice', 'fill'),
    p('化学与环境保护', 'choice', 'fill', 'solve')),
]

const C_X1: Chapter[] = [
  ch('第1章 化学反应与能量',
    p('反应热与焓变', 'choice', 'fill', 'solve'),
    p('热化学方程式', 'choice', 'fill', 'solve'),
    p('燃烧热与中和反应反应热的测定', 'choice', 'fill', 'solve', 'exp'),
    p('盖斯定律及其应用', 'choice', 'fill', 'solve')),
  ch('第2章 化学反应速率与化学平衡',
    p('化学反应速率及其影响因素', 'choice', 'fill', 'solve', 'exp'),
    p('化学平衡状态与平衡移动', 'choice', 'fill', 'solve'),
    p('化学平衡常数', 'choice', 'fill', 'solve'),
    p('化学平衡图像与综合应用', 'choice', 'fill', 'solve')),
  ch('第3章 水溶液中的离子反应与平衡',
    p('弱电解质的电离平衡', 'choice', 'fill', 'solve'),
    p('水的电离与溶液的 pH', 'choice', 'fill', 'solve'),
    p('盐类的水解', 'choice', 'fill', 'solve'),
    p('沉淀溶解平衡', 'choice', 'fill', 'solve')),
  ch('第4章 电化学基础',
    p('原电池与化学电源', 'choice', 'fill', 'solve'),
    p('电解池原理及应用', 'choice', 'fill', 'solve', 'exp'),
    p('金属的电化学腐蚀与防护', 'choice', 'fill', 'solve')),
]

const C_X2: Chapter[] = [
  ch('第1章 原子结构与性质',
    p('原子结构与电子排布', 'choice', 'fill', 'solve'),
    p('原子光谱与电子跃迁', 'choice', 'fill'),
    p('元素周期律的深层解释', 'choice', 'fill', 'solve')),
  ch('第2章 分子结构与性质',
    p('共价键（σ 键、π 键、杂化）', 'choice', 'fill', 'solve'),
    p('分子的空间结构（VSEPR 模型）', 'choice', 'fill', 'solve'),
    p('分子间作用力与氢键', 'choice', 'fill', 'solve')),
  ch('第3章 晶体结构与性质',
    p('晶体的类型与性质', 'choice', 'fill'),
    p('分子晶体与共价晶体', 'choice', 'fill', 'solve'),
    p('金属晶体与离子晶体', 'choice', 'fill', 'solve')),
]

const C_X3: Chapter[] = [
  ch('第1章 有机化合物的结构特点与研究方法',
    p('有机化合物的分类与结构特点', 'choice', 'fill'),
    p('有机化合物的命名', 'choice', 'fill', 'solve'),
    p('研究有机化合物的一般步骤和方法', 'choice', 'fill')),
  ch('第2章 烃',
    p('烷烃的结构与性质', 'choice', 'fill', 'solve'),
    p('烯烃与炔烃', 'choice', 'fill', 'solve'),
    p('芳香烃（苯及其同系物）', 'choice', 'fill', 'solve')),
  ch('第3章 烃的衍生物',
    p('卤代烃', 'choice', 'fill', 'solve'),
    p('醇与酚', 'choice', 'fill', 'solve', 'exp'),
    p('醛与酮', 'choice', 'fill', 'solve'),
    p('羧酸与酯', 'choice', 'fill', 'solve', 'exp')),
  ch('第4章 生物大分子',
    p('糖类', 'choice', 'fill'),
    p('蛋白质与氨基酸', 'choice', 'fill', 'solve'),
    p('核酸', 'choice', 'fill')),
  ch('第5章 合成高分子化合物',
    p('合成高分子的基本方法（加聚、缩聚）', 'choice', 'fill', 'solve'),
    p('高分子材料的应用', 'choice', 'fill')),
]

// ============================================================
// 汇总目录：三大学科
// ============================================================

export const CATALOG: SubjectCatalog[] = [
  {
    subject: '数学',
    grades: [
      { grade: '初一', books: [{ name: '上册', chapters: M_Q7S }, { name: '下册', chapters: M_Q7X }] },
      { grade: '初二', books: [{ name: '上册', chapters: M_Q8S }, { name: '下册', chapters: M_Q8X }] },
      { grade: '初三', books: [{ name: '上册', chapters: M_Q9S }, { name: '下册', chapters: M_Q9X }] },
      { grade: '高一', books: [{ name: '必修一', chapters: M_B1 }, { name: '必修二', chapters: M_B2 }] },
      { grade: '高二', books: [{ name: '选必一', chapters: M_X1 }, { name: '选必二', chapters: M_X2 }, { name: '选必三', chapters: M_X3 }] },
      // 高三为高考总复习，复用选修模块知识点作为复习册。
      { grade: '高三', books: [{ name: '选必一', chapters: M_X1 }, { name: '选必二', chapters: M_X2 }, { name: '选必三', chapters: M_X3 }] },
    ],
  },
  {
    subject: '物理',
    grades: [
      // 初一不开设物理课程。
      { grade: '初一', books: [] },
      { grade: '初二', books: [{ name: '上册', chapters: P_Q8S }, { name: '下册', chapters: P_Q8X }] },
      { grade: '初三', books: [{ name: '上册', chapters: P_Q9S }, { name: '下册', chapters: P_Q9X }] },
      { grade: '高一', books: [{ name: '必修一', chapters: P_B1 }, { name: '必修二', chapters: P_B2 }] },
      { grade: '高二', books: [{ name: '选必一', chapters: P_X1 }, { name: '选必二', chapters: P_X2 }, { name: '选必三', chapters: P_X3 }] },
      { grade: '高三', books: [{ name: '选必一', chapters: P_X1 }, { name: '选必二', chapters: P_X2 }, { name: '选必三', chapters: P_X3 }] },
    ],
  },
  {
    subject: '化学',
    grades: [
      // 化学从初三开始开设，初一、初二无课程。
      { grade: '初一', books: [] },
      { grade: '初二', books: [] },
      { grade: '初三', books: [{ name: '上册', chapters: C_Q9S }, { name: '下册', chapters: C_Q9X }] },
      { grade: '高一', books: [{ name: '必修一', chapters: C_B1 }, { name: '必修二', chapters: C_B2 }] },
      { grade: '高二', books: [{ name: '选必一', chapters: C_X1 }, { name: '选必二', chapters: C_X2 }, { name: '选必三', chapters: C_X3 }] },
      { grade: '高三', books: [{ name: '选必一', chapters: C_X1 }, { name: '选必二', chapters: C_X2 }, { name: '选必三', chapters: C_X3 }] },
    ],
  },
]

// ============================================================
// 查询接口
// ============================================================

function getSubject(subject: string): SubjectCatalog | undefined {
  return CATALOG.find(s => s.subject === subject)
}
function getGrade(subject: string, grade: string): GradeCatalog | undefined {
  return getSubject(subject)?.grades.find(g => g.grade === grade)
}
function getBook(subject: string, grade: string, book: string): Book | undefined {
  return getGrade(subject, grade)?.books.find(b => b.name === book)
}

/** 列出全部学科。 */
export function listSubjects(): string[] {
  return CATALOG.map(s => s.subject)
}

/** 列出某学科的全部年级。 */
export function listGrades(subject: string): string[] {
  return getSubject(subject)?.grades.map(g => g.grade) ?? []
}

/** 列出某学科某年级的全部册别。 */
export function listBooks(subject: string, grade: string): string[] {
  return getGrade(subject, grade)?.books.map(b => b.name) ?? []
}

/** 列出某册的全部章节。 */
export function listChapters(subject: string, grade: string, book: string): string[] {
  return getBook(subject, grade, book)?.chapters.map(c => c.name) ?? []
}

/** 列出某章节的全部知识点。 */
export function listPoints(subject: string, grade: string, book: string, chapter: string): KnowledgePoint[] {
  return getBook(subject, grade, book)?.chapters.find(c => c.name === chapter)?.points ?? []
}

/**
 * 在某学科某年级范围内按关键词检索知识点。
 * 知识点名称或所属章节名称包含 keyword 即命中；同名结果去重。
 */
export function findKnowledge(
  subject: string,
  grade: string,
  keyword: string,
): Array<{ chapter: string; point: KnowledgePoint }> {
  const g = getGrade(subject, grade)
  if (!g || !keyword) return []
  const result: Array<{ chapter: string; point: KnowledgePoint }> = []
  const seen = new Set<string>()
  for (const book of g.books) {
    for (const chapter of book.chapters) {
      const chapterHit = chapter.name.includes(keyword)
      for (const point of chapter.points) {
        if (!chapterHit && !point.name.includes(keyword)) continue
        const key = `${chapter.name}::${point.name}`
        if (seen.has(key)) continue
        seen.add(key)
        result.push({ chapter: chapter.name, point })
      }
    }
  }
  return result
}

/** 统计整个目录的规模（含教材版本维度）。 */
export function catalogStats(): {
  subjects: number
  grades: number
  books: number
  chapters: number
  points: number
  editions: number
  byEdition: Record<string, { chapters: number; points: number }>
} {
  let grades = 0
  let books = 0
  let chapters = 0
  let points = 0
  for (const s of CATALOG) {
    for (const g of s.grades) {
      grades++
      for (const b of g.books) {
        books++
        chapters += b.chapters.length
        for (const c of b.chapters) points += c.points.length
      }
    }
  }
  const byEdition: Record<string, { chapters: number; points: number }> = {}
  for (const [edition, catalog] of EDITION_CATALOGS) {
    let ec = 0
    let ep = 0
    for (const s of catalog) {
      for (const g of s.grades) {
        for (const b of g.books) {
          ec += b.chapters.length
          for (const c of b.chapters) ep += c.points.length
        }
      }
    }
    byEdition[edition] = { chapters: ec, points: ep }
  }
  return {
    subjects: CATALOG.length,
    grades,
    books,
    chapters,
    points,
    editions: EDITIONS.length,
    byEdition,
  }
}

// ============================================================
// 教材版本维度：人教版 / 北师大版 / 沪教版 / 华师大版 / 苏教版
// ------------------------------------------------------------
// 设计：知识点池版本无关（题型继承），章节划分按版本组织。
//   人教版：直接复用 CATALOG（保证与原 6 个接口结果完全一致）。
//   数学非人教：章节名是版本特色，考点从 pointPool 按主题关键词引用。
//   物理/化学非人教：章节体系与人教大体一致（课标统一），直接复用原章节数组。
// ============================================================

export type EditionName = '人教版' | '北师大版' | '沪教版' | '华师大版' | '苏教版'

export const EDITIONS: EditionName[] = ['人教版', '北师大版', '沪教版', '华师大版', '苏教版']

/** 版本无关考点池：从现有人教版全部章节收集，key=知识点 name，value=含 types 的知识点对象。 */
const pointPool = new Map<string, KnowledgePoint>()
for (const s of CATALOG) {
  for (const g of s.grades) {
    for (const b of g.books) {
      for (const c of b.chapters) {
        for (const pt of c.points) {
          if (!pointPool.has(pt.name)) pointPool.set(pt.name, pt)
        }
      }
    }
  }
}

/** 版本特有考点：池中没有时用 p() 现造并加入池（题型继承机制一致）。 */
function ensurePoint(name: string, ...types: QType[]): KnowledgePoint {
  let pt = pointPool.get(name)
  if (!pt) {
    pt = p(name, ...types)
    pointPool.set(name, pt)
  }
  return pt
}
// 沪教预备级（整除/比例）与华师大「圆的初步」等版本特有考点
ensurePoint('整除与倍数', 'choice', 'fill', 'solve')
ensurePoint('比和比例的性质', 'choice', 'fill', 'solve')
ensurePoint('圆的初步认识', 'choice', 'fill')

/** 主题关键词表：章节名命中 pattern 时，展开为考点名关键字（在池内做包含匹配）。 */
const TOPIC_KEYWORDS: Array<[pattern: string, keywords: string[]]> = [
  ['丰富的图形世界', ['图形', '直线', '射线', '线段', '角']],
  ['走进图形世界', ['图形', '直线', '射线', '线段', '角']],
  ['图形的初步认识', ['图形', '直线', '射线', '线段', '角']],
  ['基本平面图形', ['直线', '射线', '线段', '角', '图形']],
  ['平面图形的认识', ['直线', '射线', '线段', '角', '对顶角', '平行线', '三角形']],
  ['数学与你同行', ['有理数', '方程', '图形']],
  ['有理数', ['有理数', '正数与负数', '数轴', '绝对值', '科学记数法', '近似数']],
  ['数的整除', ['整除与倍数', '有理数', '分数']],
  ['分数', ['分数', '有理数', '整除与倍数']],
  ['比和比例', ['比和比例的性质', '比例', '有理数']],
  ['整式的加减', ['整式', '单项式', '多项式', '合并同类项', '去括号']],
  ['代数式', ['整式', '单项式', '多项式']],
  ['整式的乘除', ['整式的乘法', '同底数幂', '乘法公式', '因式分解']],
  ['整式的乘法', ['整式的乘法', '同底数幂', '乘法公式']],
  ['幂的运算', ['同底数幂', '幂的乘方', '积的乘方']],
  ['因式分解', ['因式分解', '提公因式', '公式法']],
  ['一次方程', ['一元一次方程', '方程与方程的解', '等式的基本性质', '解一元一次方程']],
  ['二元一次方程组', ['二元一次方程组', '代入消元法', '加减消元法']],
  ['一元一次不等式', ['不等式', '一元一次不等式', '不等式组', '方案选择']],
  ['不等式', ['不等式', '一元一次不等式', '不等式组']],
  ['一元二次方程', ['一元二次方程', '根的判别式', '韦达', '配方法', '公式法', '因式分解法']],
  ['代数方程', ['一元二次方程', '分式方程', '二元一次方程组']],
  ['二次根式', ['二次根式', '根式']],
  ['根式', ['二次根式', '根式']],
  ['分式方程', ['分式方程', '分式']],
  ['分式', ['分式', '分式方程']],
  ['勾股定理', ['勾股定理']],
  ['实数', ['实数', '平方根', '立方根', '无理数']],
  ['数的开方', ['平方根', '立方根', '算术平方根', '实数']],
  ['平方根与立方根', ['平方根', '立方根', '算术平方根']],
  ['相交线', ['对顶角', '邻补角', '垂线', '平行线的判定', '平行线的性质']],
  ['平行线', ['平行线', '对顶角', '垂线']],
  ['三角形', ['三角形', '全等', '内角和', '三边关系', '高、中线']],
  ['全等三角形', ['全等', 'SSS', 'SAS', 'ASA', 'AAS', 'HL']],
  ['多边形', ['多边形', '内角和', '对角线']],
  ['四边形', ['平行四边形', '矩形', '菱形', '正方形', '中位线']],
  ['矩形菱形正方形', ['矩形', '菱形', '正方形', '平行四边形']],
  ['轴对称', ['轴对称', '垂直平分线', '等腰三角形', '等边三角形']],
  ['平移与旋转', ['平移', '旋转', '中心对称']],
  ['旋转', ['旋转', '中心对称']],
  ['位置与坐标', ['坐标', '平面直角坐标系', '有序数对']],
  ['平面直角坐标系', ['坐标', '平面直角坐标系', '有序数对']],
  ['证明', ['全等', '平行线', '三角形', '相似']],
  ['圆的初步', ['圆', '圆周角', '切线', '弧', '弦', '圆的初步认识']],
  ['圆和扇形', ['圆', '弧', '扇形', '圆周角', '切线']],
  ['圆', ['圆', '圆周角', '切线', '弧', '弦', '扇形', '垂径']],
  ['相似', ['相似', '位似', '成比例线段']],
  ['视图与投影', ['三视图', '投影', '几何体']],
  ['投影与视图', ['三视图', '投影', '几何体']],
  ['锐角三角函数', ['三角函数', '正弦', '余弦', '正切', '解直角三角形']],
  ['直角三角形的边角关系', ['三角函数', '正弦', '余弦', '正切', '解直角三角形']],
  ['三角比', ['三角函数', '正弦', '余弦', '正切', '特殊角']],
  ['解直角三角形', ['解直角三角形', '三角函数', '特殊角']],
  ['集合与逻辑', ['集合', '充分条件', '必要条件', '量词', '命题']],
  ['集合', ['集合', '交集', '并集', '补集']],
  ['反比例函数', ['反比例函数', 'k 的几何意义']],
  ['正比例函数', ['正比例函数', '一次函数']],
  ['二次函数', ['二次函数', '最值', '图象平移']],
  ['一次函数', ['一次函数', '正比例函数', '待定系数法']],
  ['函数', ['函数', '一次函数', '二次函数', '反比例函数']],
  ['数据的收集', ['统计调查', '抽样', '条形图', '扇形图', '直方图']],
  ['数据的整理与统计', ['统计调查', '条形图', '扇形图', '直方图', '平均数']],
  ['数据的收集与表示', ['统计调查', '条形图', '扇形图', '直方图']],
  ['数据的分析与决策', ['平均数', '中位数', '众数', '方差', '概率']],
  ['数据的分析', ['平均数', '中位数', '众数', '方差', '极差']],
  ['统计初步', ['统计调查', '抽样', '条形图', '平均数', '方差']],
  ['统计与概率', ['平均数', '方差', '概率', '随机事件', '抽样']],
  ['概率的进一步认识', ['概率', '随机事件', '古典概型', '频率', '树状图']],
  ['概率初步', ['概率', '随机事件', '古典概型', '频率']],
  ['概率', ['概率', '随机事件', '古典概型', '频率']],
  ['线段与角', ['线段', '角', '中点', '角平分线']],
  ['一次方程和不等式', ['一元一次方程', '不等式', '一元一次不等式']],
  ['几何证明', ['全等', '平行线', '三角形', '证明']],
  ['统计', ['抽样', '样本估计总体', '平均数', '方差']],
]

/** 从考点池为某章节挑选知识点（≥2 个），按主题相关度排序，跨版本共享同一批对象。 */
function resolvePoints(chapterName: string, keywords: string[]): KnowledgePoint[] {
  const out: KnowledgePoint[] = []
  const seen = new Set<string>()
  const add = (pt: KnowledgePoint): void => {
    if (!seen.has(pt.name)) { seen.add(pt.name); out.push(pt) }
  }
  // (1) spec 显式关键字（复用章节时即精确考点名）
  for (const kw of keywords) {
    for (const pt of pointPool.values()) if (pt.name.includes(kw)) add(pt)
  }
  // (2) 主题表兜底展开
  for (const [pattern, kws] of TOPIC_KEYWORDS) {
    if (chapterName.includes(pattern) || pattern.includes(chapterName)) {
      for (const kw of kws) {
        for (const pt of pointPool.values()) if (pt.name.includes(kw)) add(pt)
      }
    }
  }
  // (3) n-gram 兜底（覆盖主题表未收录的章节名）
  if (out.length < 2) {
    const clean = chapterName.replace(/^第?\d+章\s*/, '').replace(/[（）()、，,\s]/g, '')
    const scored: Array<[KnowledgePoint, number]> = []
    for (const pt of pointPool.values()) {
      let sc = 0
      for (const n of [4, 3, 2]) {
        for (let i = 0; i + n <= clean.length; i++) {
          if (pt.name.includes(clean.slice(i, i + n))) sc += n
        }
      }
      if (clean.length === 1 && pt.name.includes(clean)) sc += 10
      if (sc > 0) scored.push([pt, sc])
    }
    scored.sort((a, b) => b[1] - a[1])
    for (const [pt] of scored) { add(pt); if (out.length >= 3) break }
  }
  // (4) 硬保底：确保每章至少 2 个知识点
  if (out.length < 2) {
    for (const pt of pointPool.values()) { add(pt); if (out.length >= 2) break }
  }
  return out
}

// —— 紧凑 spec 元组：[章节名, ...考点关键字] / [册, ...章节] / [年级, ...册] / [学科, ...年级] ——
type ChapterSpec = [name: string, ...keywords: string[]]
type BookSpec = [name: string, ...chapters: ChapterSpec[]]
type GradeSpec = [grade: string, ...books: BookSpec[]]
type SubjectSpec = [subject: string, ...grades: GradeSpec[]]

const cp = (name: string, ...kw: string[]): ChapterSpec => [name, ...kw]
const bk = (name: string, ...chs: ChapterSpec[]): BookSpec => [name, ...chs]
const gr = (name: string, ...bks: BookSpec[]): GradeSpec => [name, ...bks]
const sj = (name: string, ...grs: GradeSpec[]): SubjectSpec => [name, ...grs]

/** 直接复用人教版章节对象（物理/化学非人教、数学高中阶段）。 */
function reuse(chapters: Chapter[]): ChapterSpec[] {
  return chapters.map(c => cp(c.name, ...c.points.map(pt => pt.name)))
}

function buildCatalog(subjects: SubjectSpec[]): SubjectCatalog[] {
  return subjects.map(([subject, ...grades]) => ({
    subject,
    grades: grades.map(([grade, ...books]) => ({
      grade,
      books: books.map(([bookName, ...chapters]) => ({
        name: bookName,
        chapters: chapters.map(([chapterName, ...keywords]) => ({
          name: chapterName,
          points: resolvePoints(chapterName, keywords),
        })),
      })),
    })),
  }))
}

// 数学高中：各版本课标统一，沿用现有人教版模块章节数组。
const HIGH_SCHOOL_MATH: GradeSpec[] = [
  gr('高一', bk('必修一', ...reuse(M_B1)), bk('必修二', ...reuse(M_B2))),
  gr('高二', bk('选必一', ...reuse(M_X1)), bk('选必二', ...reuse(M_X2)), bk('选必三', ...reuse(M_X3))),
  gr('高三', bk('选必一', ...reuse(M_X1)), bk('选必二', ...reuse(M_X2)), bk('选必三', ...reuse(M_X3))),
]

/** 北师大版数学：差异主要在初中。 */
const MATH_BSD: SubjectSpec = sj('数学',
  gr('初一',
    bk('上册', cp('丰富的图形世界'), cp('有理数及其运算'), cp('整式及其加减'),
      cp('基本平面图形'), cp('一元一次方程'), cp('数据的收集与整理')),
    bk('下册', cp('整式的乘除'), cp('因式分解'), cp('二元一次方程组'),
      cp('不等式与不等式组'), cp('相交线与平行线'), cp('三角形'), cp('概率初步'))),
  gr('初二',
    bk('上册', cp('勾股定理'), cp('实数'), cp('位置与坐标'), cp('一次函数'), cp('平行四边形')),
    bk('下册', cp('三角形的证明'), cp('图形的平移与旋转'), cp('因式分解'),
      cp('分式与分式方程'), cp('平行四边形'), cp('数据的分析'))),
  gr('初三',
    bk('上册', cp('一元二次方程'), cp('概率的进一步认识'), cp('图形的相似'),
      cp('证明（三）'), cp('视图与投影'), cp('反比例函数')),
    bk('下册', cp('直角三角形的边角关系'), cp('二次函数'), cp('圆'), cp('统计与概率'))),
  ...HIGH_SCHOOL_MATH,
)

/** 沪教版数学：五四学制——六上/六下=初中预备(初一)，七=初二，八/九=初三；册名统一「上册/下册」以对齐接口。 */
const MATH_SH: SubjectSpec = sj('数学',
  gr('初一',
    bk('上册', cp('数的整除'), cp('分数'), cp('比和比例'), cp('圆和扇形')),
    bk('下册', cp('有理数'), cp('一次方程和不等式'), cp('线段与角'), cp('二元一次方程组'))),
  gr('初二',
    bk('上册', cp('整式'), cp('分式'), cp('根式'), cp('一元二次方程'), cp('勾股定理')),
    bk('下册', cp('相交线平行线'), cp('三角形'), cp('四边形'), cp('一次函数'), cp('数据的整理与统计'))),
  gr('初三',
    // 八上+八下
    bk('上册', cp('二次根式'), cp('一元二次方程'), cp('正比例函数与反比例函数'),
      cp('几何证明'), cp('一次函数'), cp('代数方程'), cp('四边形'), cp('圆'), cp('概率初步')),
    // 九上+九下
    bk('下册', cp('集合与逻辑'), cp('函数'), cp('三角比'), cp('圆'), cp('相似形'),
      cp('二次函数'), cp('统计初步'))),
  ...HIGH_SCHOOL_MATH,
)

/** 苏教版数学。 */
const MATH_JS: SubjectSpec = sj('数学',
  gr('初一',
    bk('上册', cp('数学与你同行'), cp('有理数'), cp('代数式'), cp('一元一次方程'),
      cp('走进图形世界'), cp('平面图形的认识（一）')),
    bk('下册', cp('幂的运算'), cp('整式乘法与因式分解'), cp('二元一次方程组'),
      cp('一元一次不等式'), cp('平面图形的认识（二）'), cp('数据的收集与整理'))),
  gr('初二',
    bk('上册', cp('全等三角形'), cp('轴对称'), cp('勾股定理'), cp('平方根与立方根'),
      cp('实数'), cp('一次函数')),
    bk('下册', cp('二次根式'), cp('一元二次方程'), cp('平行四边形'), cp('矩形菱形正方形'),
      cp('分式'), cp('反比例函数'), cp('数据的分析'))),
  gr('初三',
    bk('上册', cp('一元二次方程'), cp('圆'), cp('概率初步'), cp('二次函数'), cp('锐角三角函数')),
    bk('下册', cp('图形的相似'), cp('解直角三角形'), cp('统计与概率'))),
  ...HIGH_SCHOOL_MATH,
)

/** 华师大版数学。 */
const MATH_HSD: SubjectSpec = sj('数学',
  gr('初一',
    bk('上册', cp('有理数'), cp('数的开方'), cp('整式的加减'), cp('图形的初步认识'),
      cp('数据的收集与表示')),
    bk('下册', cp('一元一次方程'), cp('二元一次方程组'), cp('一元一次不等式'),
      cp('多边形'), cp('旋转'), cp('数据的分析与决策'))),
  gr('初二',
    bk('上册', cp('数的开方'), cp('整式的乘除'), cp('勾股定理'), cp('平行线'),
      cp('全等三角形'), cp('一次函数')),
    bk('下册', cp('分式'), cp('二次根式'), cp('一元二次方程'), cp('四边形'),
      cp('数据的分析'), cp('概率初步'))),
  gr('初三',
    bk('上册', cp('二次根式'), cp('一元二次方程'), cp('圆的初步'), cp('相似图形'),
      cp('解直角三角形')),
    bk('下册', cp('二次函数'), cp('统计与概率'), cp('圆'))),
  ...HIGH_SCHOOL_MATH,
)

/** 物理：各版本初中「力热光电声」章节体系与人教大体一致（参照课标），直接复用。 */
function physicsSpec(): SubjectSpec {
  return sj('物理',
    gr('初一'),
    gr('初二', bk('上册', ...reuse(P_Q8S)), bk('下册', ...reuse(P_Q8X))),
    gr('初三', bk('上册', ...reuse(P_Q9S)), bk('下册', ...reuse(P_Q9X))),
    gr('高一', bk('必修一', ...reuse(P_B1)), bk('必修二', ...reuse(P_B2))),
    gr('高二', bk('选必一', ...reuse(P_X1)), bk('选必二', ...reuse(P_X2)), bk('选必三', ...reuse(P_X3))),
    gr('高三', bk('选必一', ...reuse(P_X1)), bk('选必二', ...reuse(P_X2)), bk('选必三', ...reuse(P_X3))),
  )
}

/** 化学：各版本考点一致，直接复用人教章节（初中从初三起开设）。 */
function chemistrySpec(): SubjectSpec {
  return sj('化学',
    gr('初一'),
    gr('初二'),
    gr('初三', bk('上册', ...reuse(C_Q9S)), bk('下册', ...reuse(C_Q9X))),
    gr('高一', bk('必修一', ...reuse(C_B1)), bk('必修二', ...reuse(C_B2))),
    gr('高二', bk('选必一', ...reuse(C_X1)), bk('选必二', ...reuse(C_X2)), bk('选必三', ...reuse(C_X3))),
    gr('高三', bk('选必一', ...reuse(C_X1)), bk('选必二', ...reuse(C_X2)), bk('选必三', ...reuse(C_X3))),
  )
}

/** 版本 → 目录。人教版直接引用 CATALOG，零复制。 */
const EDITION_CATALOGS = new Map<EditionName, SubjectCatalog[]>([
  ['人教版', CATALOG],
  ['北师大版', buildCatalog([MATH_BSD, physicsSpec(), chemistrySpec()])],
  ['沪教版', buildCatalog([MATH_SH, physicsSpec(), chemistrySpec()])],
  ['华师大版', buildCatalog([MATH_HSD, physicsSpec(), chemistrySpec()])],
  ['苏教版', buildCatalog([MATH_JS, physicsSpec(), chemistrySpec()])],
])

// —— 版本内查询辅助 ——
function editionCatalog(edition: string): SubjectCatalog[] {
  return EDITION_CATALOGS.get(edition as EditionName) ?? CATALOG
}
function eGetSubject(cat: SubjectCatalog[], subject: string): SubjectCatalog | undefined {
  return cat.find(s => s.subject === subject)
}
function eGetGrade(cat: SubjectCatalog[], subject: string, grade: string): GradeCatalog | undefined {
  return eGetSubject(cat, subject)?.grades.find(g => g.grade === grade)
}
function eGetBook(cat: SubjectCatalog[], subject: string, grade: string, book: string): Book | undefined {
  return eGetGrade(cat, subject, grade)?.books.find(b => b.name === book)
}

/** 列出全部教材版本；传 subject 时返回该学科实际开设（有教材）的版本。 */
export function listEditions(subject?: string): string[] {
  if (!subject) return [...EDITIONS]
  return EDITIONS.filter(e => {
    const cat = EDITION_CATALOGS.get(e)
    return !!cat && cat.some(s => s.subject === subject && s.grades.some(g => g.books.length > 0))
  })
}

/** 版本-aware：列出某版本某学科某年级的全部册别。 */
export function listBooksForEdition(subject: string, grade: string, edition: string): string[] {
  return eGetGrade(editionCatalog(edition), subject, grade)?.books.map(b => b.name) ?? []
}

/** 版本-aware：列出某版本某册的全部章节。 */
export function listChaptersForEdition(subject: string, grade: string, book: string, edition: string): string[] {
  return eGetBook(editionCatalog(edition), subject, grade, book)?.chapters.map(c => c.name) ?? []
}

/** 版本-aware：列出某版本某章节的全部知识点。 */
export function listPointsForEdition(
  subject: string, grade: string, book: string, chapter: string, edition: string,
): KnowledgePoint[] {
  return eGetBook(editionCatalog(edition), subject, grade, book)?.chapters.find(c => c.name === chapter)?.points ?? []
}

/** 版本-aware：在某版本某学科某年级范围内按关键词检索知识点（章节名或知识点名命中，去重）。 */
export function findKnowledgeForEdition(
  subject: string, grade: string, keyword: string, edition: string,
): Array<{ chapter: string; point: KnowledgePoint }> {
  const g = eGetGrade(editionCatalog(edition), subject, grade)
  if (!g || !keyword) return []
  const result: Array<{ chapter: string; point: KnowledgePoint }> = []
  const seen = new Set<string>()
  for (const book of g.books) {
    for (const chapter of book.chapters) {
      const chapterHit = chapter.name.includes(keyword)
      for (const point of chapter.points) {
        if (!chapterHit && !point.name.includes(keyword)) continue
        const key = `${chapter.name}::${point.name}`
        if (seen.has(key)) continue
        seen.add(key)
        result.push({ chapter: chapter.name, point })
      }
    }
  }
  return result
}
