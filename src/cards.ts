// 参数确认卡片（两段式 / 方案 B）——chat_ui 载荷生成器
//
// 为什么由插件生成载荷、而不是让模型自己设计卡片：
//   · 只有 dsh-tool-cards 的 chat_ui 工具能签发提交凭证，所以卡片必须由模型"调用"出来；
//   · 但"卡片长什么样"是产品决定，不是模型决定 —— 让它自己画会漂移、还多烧几千 token。
//   · 因此本模块把布局写死成常量，模型只做一件事：把这里产出的 title/ui 原样交给 chat_ui。
//
// 布局（甲方选定 方案 B 两段式）：
//   常显 4 行  →  年级 / 科目 / 范围 / 数量
//   折叠 1 层  →  Popover「更多设置」，装难度、题型、答案页等低频项
//   底部 1 键  →  唯一的出口，文案描述用户的下一步动作
// Popover 的开关是组件本地状态，纯本地展开，零往返、零额外 token。

import { specFor, totalCount } from './exam-spec.js'

/** 五个功能的 mode 标识，与 generate_content 的 mode 枚举一致。 */
export type CardMode = 'paper' | 'drill' | 'lesson' | 'graph' | 'sync'

export interface CardOption {
  label: string
  value: string
}

interface FieldSpec {
  // Checkboxes = 一组布尔勾选框，用于「年级多选」；每个选项绑到 `key::值` 状态键
  type: 'Select' | 'Segmented' | 'Slider' | 'Input' | 'Checkboxes'
  key: string
  label: string
  options?: CardOption[]
  placeholder?: string
  /** 默认值；缺省时用选项第一项或滑杆最小值。 */
  defaultValue?: string | number
  min?: number
  max?: number
  step?: number
  unit?: string
}

interface ModeCardSpec {
  title: string
  subtitle: string
  submitLabel: string
  /** 常显字段。 */
  always: FieldSpec[]
  /** 收进「更多设置」的字段。 */
  more: FieldSpec[]
}

/* --------------------------------- 取值表 --------------------------------- */

const GRADES: CardOption[] = [
  { label: '初一', value: '初一' },
  { label: '初二', value: '初二' },
  { label: '初三', value: '初三' },
  { label: '高一', value: '高一' },
  { label: '高二', value: '高二' },
  { label: '高三', value: '高三' },
]

/** 多选年级的状态键：grade::初一 这类，Checkboxes 组件逐项绑定。 */
export function gradeStateKey(value: string): string {
  return `grade::${value}`
}

const SUBJECTS: CardOption[] = [
  { label: '数学', value: '数学' },
  { label: '物理', value: '物理' },
  { label: '化学', value: '化学' },
  { label: '生物', value: '生物' },
]

// 学段：甲方要「中考 / 高考」入口。选中后写进 brief，parse-brief 已把
// 「高考」映射高三、「中考」映射初三；这里只影响卷面规格（高考卷/中考卷）。
const STAGES: CardOption[] = [
  { label: '不限', value: '' },
  { label: '中考', value: '中考' },
  { label: '高考', value: '高考' },
]

// 范围用输入框而不是下拉：十来个章节选项要占掉两百多字符的载荷，
// 而这份 JSON 是模型逐字复述的 —— 每多一个字符都多一分输出成坏 JSON 的风险。
// 空值等于 auto：留空就按年级科目自动取核心章节。
const SCOPES: CardOption[] = []

const DIFFICULTY: CardOption[] = [
  { label: '基础', value: '基础' },
  { label: '中等', value: '中等' },
  { label: '拔高', value: '拔高' },
]

const TYPES: CardOption[] = [
  { label: '混合', value: 'mixed' },
  { label: '单选题', value: 'choice' },
  { label: '多选题', value: 'multi' },
  { label: '填空题', value: 'fill' },
  { label: '解答题', value: 'solve' },
]

const ANSWER: CardOption[] = [
  { label: '附答案页', value: 'true' },
  { label: '不附', value: 'false' },
]

const VARIATION: CardOption[] = [
  { label: '基础变式', value: '基础变式' },
  { label: '综合变式', value: '综合变式' },
  { label: '跨章变式', value: '跨章变式' },
]

const FOCUS: CardOption[] = [
  { label: '讲解为主', value: '讲解为主' },
  { label: '讲练均衡', value: '讲练均衡' },
  { label: '练习为主', value: '练习为主' },
]

const FORMULAS: CardOption[] = [
  { label: '带公式', value: 'true' },
  { label: '不带公式', value: 'false' },
]

const EXAM_FREQ: CardOption[] = [
  { label: '标注考频', value: 'true' },
  { label: '不标注', value: 'false' },
]

// 教材版本：与 knowledge-catalog.ts 的 EDITIONS 完全对齐（5 版）。
const TEXTBOOKS: CardOption[] = [
  { label: '人教版', value: '人教版' },
  { label: '北师大版', value: '北师大版' },
  { label: '沪教版', value: '沪教版' },
  { label: '华师大版', value: '华师大版' },
  { label: '苏教版', value: '苏教版' },
]
const TEXTBOOK_F: FieldSpec = { key: 'textbook', type: 'Select', label: '教材版本', options: TEXTBOOKS, defaultValue: '人教版' }

const RATIO: CardOption[] = [
  { label: '基础为主 7:3', value: '7:3' },
  { label: '均衡 5:5', value: '5:5' },
  { label: '提高为主 3:7', value: '3:7' },
]

/* ------------------------------- 每个功能的卡片 ------------------------------- */

// 共用前四行：年级(下拉) / 科目(分段) / 范围(下拉) / 数量(滑杆)
// 年级 6 个选项超过 Segmented 的 5 项上限（会被自动降级成下拉），所以直接用 Select，
// 免得"文档里是胶囊、实现里是下拉"这种落差。
const GRADE: FieldSpec = { key: 'grade', type: 'Select', label: '年级', options: GRADES }
// 甲方要求：年级可多选（初一+初二、高一+高二+高三同选 → 跨年级知识点卷）。
// 用一组 Checkbox 逐项绑 grade::初一 这类状态键，提交时全部带出。
const GRADE_MULTI: FieldSpec = { key: 'grade', type: 'Checkboxes', label: '年级（可多选）', options: GRADES }
const STAGE_F: FieldSpec = { key: 'stage', type: 'Segmented', label: '学段', options: STAGES }
const SUBJECT: FieldSpec = { key: 'subject', type: 'Segmented', label: '科目', options: SUBJECTS }
const SCOPE: FieldSpec = { key: 'scope', type: 'Input', label: '范围', placeholder: '留空=自动取核心章节' }
const COUNT: FieldSpec = { key: 'count', type: 'Slider', label: '数量', min: 1, max: 30, step: 1, unit: '题' }
const DIFFICULTY_F: FieldSpec = { key: 'difficulty', type: 'Segmented', label: '难度', options: DIFFICULTY, defaultValue: '中等' }
const TYPES_F: FieldSpec = { key: 'types', type: 'Segmented', label: '题型', options: TYPES }
const ANSWER_F: FieldSpec = { key: 'withAnswer', type: 'Segmented', label: '答案页', options: ANSWER }

const MODES: Record<CardMode, ModeCardSpec> = {
  paper: {
    title: '出题参数',
    subtitle: '智能组卷 · 年级可多选（跨年级组卷）· 已按默认值预填',
    submitLabel: '生成试卷',
    // 甲方要求：年级可多选 + 中考/高考学段 + 题量。学段与多选年级放常显。
    // 其余全收进「更多设置」——少一行字段就少几十个字符的模型输出。
    always: [GRADE_MULTI, STAGE_F, SUBJECT, COUNT],
    more: [SCOPE, TEXTBOOK_F, DIFFICULTY_F, TYPES_F, ANSWER_F],
  },
  drill: {
    title: '专项参数',
    subtitle: '专项能力突破 · 选好范围就能出变式',
    submitLabel: '生成专项练习',
    always: [GRADE, SUBJECT, SCOPE],
    more: [COUNT, DIFFICULTY_F, { key: 'variation', type: 'Segmented', label: '变式', options: VARIATION }],
  },
  lesson: {
    title: '讲义参数',
    subtitle: '个性化教学讲义 · 讲解与练习按你选的配比',
    submitLabel: '生成讲义',
    always: [GRADE, SUBJECT, SCOPE],
    more: [COUNT, { key: 'length', type: 'Slider', label: '课时', min: 1, max: 4, step: 1, unit: '课时' },
      { key: 'focus', type: 'Segmented', label: '侧重', options: FOCUS }],
  },
  graph: {
    title: '图谱参数',
    subtitle: '知识图谱梳理 · 输出层级结构，不画图',
    submitLabel: '梳理知识图谱',
    always: [GRADE, SUBJECT, SCOPE],
    more: [{ key: 'withFormula', type: 'Segmented', label: '公式', options: FORMULAS },
      { key: 'withExamFreq', type: 'Segmented', label: '考频', options: EXAM_FREQ }],
  },
  sync: {
    title: '同步参数',
    subtitle: '教材同步训练 · 按版本与章节对齐',
    submitLabel: '生成同步练习',
    always: [GRADE, SUBJECT,
      { key: 'textbook', type: 'Segmented', label: '版本', options: TEXTBOOKS },
      SCOPE],
    more: [COUNT, DIFFICULTY_F, { key: 'ratio', type: 'Segmented', label: '配比', options: RATIO }],
  },
}

/* --------------------------------- 载荷类型 --------------------------------- */

interface UiNode {
  id: string
  type: string
  label?: string
  bind?: string
  props?: Record<string, unknown>
  children?: UiNode[]
  actionId?: string
}

interface SubmitAction {
  kind: 'submitToAgent'
  operation: string
  includeKeys: string[]
}

/** 与 dsh-tool-cards 的 chat-ui/1.0 契约一致的完整调用参数。 */
export interface ParamCardSpec {
  title: string
  ui: {
    schemaVersion: 'chat-ui/1.0'
    initialState: Record<string, unknown>
    tree: UiNode
    actions: Record<string, SubmitAction>
  }
}

/* --------------------------------- 生成载荷 --------------------------------- */

function defaultsOf(fields: FieldSpec[]): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const field of fields) {
    if (field.type === 'Checkboxes') {
      // 多选年级：每个选项一个布尔状态键，默认只选第一个（初一）。
      // 同时保留 grade 字符串，兼容下游只读单个年级的分支。
      const options = field.options ?? []
      options.forEach((opt, i) => {
        values[gradeStateKey(opt.value)] = i === 0
      })
      values[field.key] = options[0]?.value ?? ''
      continue
    }
    if (field.defaultValue !== undefined) {
      values[field.key] = field.defaultValue
      continue
    }
    if (field.type === 'Slider') {
      values[field.key] = field.key === 'count' ? 5 : (field.min ?? 1)
      continue
    }
    values[field.key] = field.options?.[0]?.value ?? ''
  }
  return values
}

function nodeOf(field: FieldSpec): UiNode {
  // label 必须放在 props 里：组件从 element.props.label 取字段标题，协议级 node.label 只是壳。
  if (field.type === 'Checkboxes') {
    // 一组复选框，每个绑 `grade::值` 布尔状态键；Column 把它们竖排，比横排胶囊更清楚。
    return {
      id: field.key,
      type: 'Column',
      props: { label: field.label, gap: 4 },
      children: (field.options ?? []).map((opt) => ({
        id: gradeStateKey(opt.value),
        type: 'Checkbox',
        bind: gradeStateKey(opt.value),
        props: { label: opt.label },
      })),
    }
  }
  if (field.type === 'Slider') {
    return {
      id: field.key,
      type: 'Slider',
      bind: field.key,
      props: { label: field.label, min: field.min ?? 1, max: field.max ?? 20, step: field.step ?? 1, unit: field.unit },
    }
  }
  if (field.type === 'Input') {
    return {
      id: field.key,
      type: 'Input',
      bind: field.key,
      props: { label: field.label, placeholder: field.placeholder ?? '' },
    }
  }
  return {
    id: field.key,
    type: field.type,
    bind: field.key,
    props: { label: field.label, options: field.options ?? [] },
  }
}

/**
 * 只读回显行：Segmented 在当前主题下选中态对比很弱（白底压在白色卡片上），
 * 协议里又没有「动态文本」节点（Text 只渲染静态 props.text，不接 binding），
 * 所以用一个 disabled Input 绑定同一个 state 键，把当前值显示成文字。
 */
function echoOf(field: FieldSpec): UiNode {
  return {
    id: `${field.key}Echo`,
    type: 'Input',
    bind: field.key,
    props: { label: `当前${field.label}`, disabled: true },
  }
}

/**
 * 产出「两段式」参数卡片：常显字段平铺，低频字段塞进 Popover，底部一个提交按钮。
 *
 * @param mode   五个功能之一
 * @param preset 上一次的选择或模型传入的参数；缺项自动落默认值，绝不留空
 */
export function buildParamCard(mode: CardMode, preset: Record<string, unknown> = {}): ParamCardSpec {
  const spec = MODES[mode] ?? MODES.paper
  const all = [...spec.always, ...spec.more]
  const baseline = defaultsOf(all)

  // 题量默认 = 该年级科目对应的「真实卷面」题量（初中 22、高中 18），而不是写死 5 道。
  // 用户改过 count 就尊重他（preset.count 会覆盖），没改过就是完整一套卷。
  if (all.some((field) => field.key === 'count')) {
    const grade = String(preset.grade ?? baseline.grade ?? '初一')
    const subject = String(preset.subject ?? baseline.subject ?? '数学')
    baseline.count = totalCount(specFor(grade, subject))
  }

  // 只接受表里声明过的键，避免模型塞进来一堆没用的状态（也避免 60 键上限被吃掉）。
  const values: Record<string, unknown> = { ...baseline }
  for (const field of all) {
    const given = preset[field.key]
    if (given === undefined || given === null || given === '') continue
    values[field.key] = typeof given === 'boolean' ? String(given) : given
  }
  // 多选年级：preset.grade 可能是「初一,初二」逗号串或数组，展开到各 grade:: 布尔键。
  if (all.some((field) => field.type === 'Checkboxes')) {
    const rawGrade = preset.grade ?? values.grade
    const picked = Array.isArray(rawGrade)
      ? rawGrade.map(String)
      : String(rawGrade ?? '').split(/[,，、\s]+/).filter(Boolean)
    const validGrades = new Set(GRADES.map((g) => g.value))
    const chosen = picked.filter((g) => validGrades.has(g))
    if (chosen.length > 0) {
      for (const opt of GRADES) values[gradeStateKey(opt.value)] = chosen.includes(opt.value)
      values.grade = chosen.join(',') // 供下游 parseBrief 认多年级
    }
  }

  const tree: UiNode = {
    id: 'root',
    type: 'Card',
    props: { title: spec.title, subtitle: spec.subtitle },
    children: [
      // 科目是分段按钮，选中态最不明显 → 前面挂一行只读回显。
      ...spec.always.flatMap((field) =>
        field.key === 'subject' ? [echoOf(field), nodeOf(field)] : [nodeOf(field)],
      ),
      ...(spec.more.length > 0
        ? [{
            id: 'more',
            type: 'Popover',
            props: {
              trigger: '更多设置',
              placement: 'bottom',
            },
            children: spec.more.map((field) => nodeOf(field)),
          } as UiNode]
        : []),
      { id: 'rule', type: 'Divider' },
      { id: 'go', type: 'Button', label: spec.submitLabel, props: { variant: 'primary' }, actionId: 'submit' },
    ],
  }

  // 提交键：普通字段直接用 key；多选年级要同时带出
  // ① grade:: 各布尔键（勾选状态）② grade 字符串（逗号串，下游 parseBrief 认多年级）。
  // 学段 stage 是普通 Segmented，自动走 [field.key]。漏了 grade 字符串就白选。
  const includeKeys = all.flatMap((field) =>
    field.type === 'Checkboxes'
      ? [field.key, ...(field.options ?? []).map((opt) => gradeStateKey(opt.value))]
      : [field.key],
  )

  return {
    title: spec.title,
    ui: {
      schemaVersion: 'chat-ui/1.0',
      initialState: values,
      tree,
      actions: {
        submit: { kind: 'submitToAgent', operation: `exam-${mode}`, includeKeys },
      },
    },
  }
}

/** 卡片标题里的功能名，给日志和模型提示用。 */
export function modeLabel(mode: CardMode): string {
  return MODES[mode]?.subtitle.split(' · ')[0] ?? '智能组卷'
}

/**
 * 给模型的「最小调用骨架」。
 *
 * 为什么是骨架而不是完整 UI：模型把完整 1800 字符的 ui 重新序列化进 tool call 参数时，
 * JSON 几乎必坏（MALFORMED_RESPONSE: tool input is invalid JSON，实测 4/4 失败）。
 * 骨架只有一百来字符，模型能稳定照抄；tools/post-execute 钩子读到 tree.id，
 * 再把完整布局补进结果。tree 里故意不写 children —— 这是给钩子的标记，不是缺漏。
 */
export function cardCall(mode: CardMode, preset: Record<string, unknown> = {}): string {
  const spec = MODES[mode] ?? MODES.paper
  const initial: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(preset)) {
    if (value === undefined || value === null || value === '') continue
    initial[key] = value
  }
  const ui: Record<string, unknown> = {
    schemaVersion: 'chat-ui/1.0',
    tree: { id: mode, type: 'Card' },
  }
  if (Object.keys(initial).length > 0) ui.initialState = initial
  return JSON.stringify({ title: spec.title, ui })
}
