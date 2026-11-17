/**
 * dsh-exam-gen — 浏览器端 UI
 *
 * 布局（按甲方要求重做）：
 *   1) 左侧栏「出题」入口 = 插件总开关（开/关，默认关）。
 *   2) 右侧悬浮卡片「出题助手」= 五个功能按钮，默认缩小成小圆标，可拖动浮动。
 *   3) 点功能按钮 → 第一次弹解释气泡，再点一次打开「参数面板」。
 *   4) 参数面板 = 纯客户端渲染（零模型往返、零延迟）：科目/年级多选/学段/教材版本
 *      + 册别/章节/知识点 三级级联（fetch /exam-bank/api/catalog，浏览器本地联动）
 *      + 题量/难度/题型/答案页。点「生成」才把组合好的指令静默发给模型。
 *   5) 卡片主题自动跟随 DSH（--dsw-alias-* + 宿主实色兜底 + 暗色监听）。
 *   6) 顶部 ⓘ 展开「使用说明 / 设置」面板。
 *
 * 协议：window.__ModuleLoader__.load({ id, factory(require){...module.exports={apply,inject}} })
 * 纯手写 ES5 + react.createElement，不用 JSX / 可选链。
 */

;(function () {
  'use strict'

  var PLUGIN_ID = 'dsh-exam-gen'
  var ENTRY_ATTR = 'data-exam-gen-entry'
  var STYLE_ID = 'exam-gen-style'
  var STATE_EVENT = 'exam-gen:state-change'
  var OPEN_SETTINGS_EVENT = 'exam-gen:open-settings'
  var FALLBACK_MOUNT_ID = 'exam-gen-standalone-root'

  var ReactLib = null
  var ReactDOM = null
  // 契约探测：DSH 更新可能改掉内部 API，这里记录哪些还可用，决定走官方 slot 还是 DOM 兜底。
  var CAP = { react: false, reactdom: false, slots: false, standalone: false }
  var healTimer = null

  var GRADE_ORDER = ['初一', '初二', '初三', '高一', '高二', '高三']
  var EDITION_ORDER = ['人教版', '北师大版', '沪教版', '华师大版', '苏教版']
  var SUBJECT_ORDER = ['数学', '物理', '化学', '生物']

  var FEATURES = [
    { key: 'paper',  label: '智能组卷', desc: '出一整张卷子',       ico: '📝', tint: 'rgba(99,102,241,.12)',
      explain: '按真实中/高考卷面规格组卷：选择、多选、填空、解答四板块，题号连排、分值逐题写死。' },
    { key: 'drill',  label: '专项突破', desc: '一个知识点练透',     ico: '🎯', tint: 'rgba(239,68,68,.11)',
      explain: '锁定单个知识点，出同题型的递进变式，附「这题变在哪」和解题方法小结。' },
    { key: 'lesson', label: '教学讲义', desc: '例题 + 练习 + 解析',  ico: '📖', tint: 'rgba(16,185,129,.12)',
      explain: '三段式讲义：概念讲解 → 例题精讲 → 变式练习，适合上课直接用。' },
    { key: 'graph',  label: '知识图谱', desc: '章节覆盖度树',       ico: '🌳', tint: 'rgba(139,92,246,.12)',
      explain: '按学科→年级→册→章→知识点梳理层级树，标出每个知识点常见题型。' },
    { key: 'sync',   label: '教材同步', desc: '基础 / 提高两区',     ico: '📚', tint: 'rgba(245,158,11,.13)',
      explain: '按人教版/北师大版等教材版本与章节出同步题，分基础、提高两区，附掌握度勾选。' },
    { key: 'mimic',  label: '拖拽模仿', desc: '文档 1:1 改题出卷',   ico: '📄', tint: 'rgba(20,184,166,.12)',
      explain: '把试卷/题目文档拖进来，识别题目结构后 1:1 还原题型、题量、小问结构，只改数字与情境。' },
  ]

  var state = { enabled: false, busy: false, timer: null }
  var POS_KEY = 'exam-gen:pos'
  function readPos() {
    try {
      var raw = localStorage.getItem(POS_KEY)
      if (raw) {
        var p = JSON.parse(raw)
        if (typeof p.x === 'number' && typeof p.y === 'number') return { x: p.x, y: p.y }
      }
    } catch (e) {}
    return null
  }
  function writePos(x, y) {
    try { localStorage.setItem(POS_KEY, JSON.stringify({ x: x, y: y })) } catch (e) {}
  }

  function emitState() {
    try {
      window.dispatchEvent(new CustomEvent(STATE_EVENT, { detail: { enabled: state.enabled } }))
    } catch (e) { /* ignore */ }
  }

  /* ---------------- 样式（主题跟随 DSH） ---------------- */

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return
    var css = [
      '[' + ENTRY_ATTR + ']{cursor:pointer;display:flex;align-items:center;gap:8px;border-radius:8px;position:relative}',
      '[' + ENTRY_ATTR + '] .exam-gen-dot{width:6px;height:6px;border-radius:50%;background:#22c55e;margin-left:auto;flex:none;box-shadow:0 0 0 3px rgba(34,197,94,.16)}',
      '[' + ENTRY_ATTR + '].is-off .exam-gen-dot{background:#9ca3af;box-shadow:none}',

      '.exam-side-card{',
      '  --eg-bg:    var(--dsw-alias-bg-base, var(--eg-host-bg, #ffffff));',
      '  --eg-fg:    var(--dsw-alias-label-primary, var(--eg-host-fg, #1f2937));',
      '  --eg-fg2:   var(--dsw-alias-label-secondary, var(--eg-host-fg, #6b7280));',
      '  --eg-fg3:   var(--dsw-alias-label-tertiary, var(--eg-host-fg, #9ca3af));',
      '  --eg-line:  var(--dsw-alias-border-l2, rgba(128,128,128,.22));',
      '  --eg-brand: var(--dsw-alias-brand-primary, #6366f1);',
      '  position:fixed;width:240px;z-index:2147483000;',
      '  color:var(--eg-fg);',
      '  background:color-mix(in srgb, var(--eg-bg) 88%, transparent);',
      '  border:1px solid var(--eg-line);border-radius:14px;padding:11px 10px 9px;',
      '  box-shadow:0 1px 2px rgba(0,0,0,.04),0 12px 32px rgba(0,0,0,.10);',
      '  backdrop-filter:blur(18px) saturate(1.35);-webkit-backdrop-filter:blur(18px) saturate(1.35);',
      '  font-family:-apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif;user-select:none;',
      '  transition:width .18s ease,background .18s ease,border-color .18s ease}',
      '[data-eg-theme="dark"] .exam-side-card{',
      '  --eg-fg2:  var(--dsw-alias-label-secondary, rgba(244,244,245,.66));',
      '  --eg-fg3:  var(--dsw-alias-label-tertiary, rgba(244,244,245,.45));',
      '  --eg-line: var(--dsw-alias-border-l2, rgba(255,255,255,.12))}',

      '.exam-side-title{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:650;margin:1px 2px 10px;color:var(--eg-fg)}',
      '.exam-side-title{cursor:move}',
      '.exam-side-title .badge{width:23px;height:23px;border-radius:7px;flex:none;',
      '  background:color-mix(in srgb, var(--eg-brand) 16%, transparent);',
      '  color:var(--eg-brand);border:1px solid rgba(99,102,241,.20);',
      '  display:flex;align-items:center;justify-content:center;font-size:13px}',
      '.exam-side-title .info,.exam-side-title .min,.exam-side-title .back{flex:none;width:22px;height:22px;border:0;border-radius:6px;cursor:pointer;',
      '  background:transparent;color:var(--eg-fg3);font-size:13px;line-height:1;display:flex;align-items:center;justify-content:center;',
      '  transition:background .16s ease,color .16s ease}',
      '.exam-side-title .info{margin-left:auto;font-size:14px}',
      '.exam-side-title .info.on{color:var(--eg-brand)}',
      '.exam-side-title .info:hover,.exam-side-title .min:hover,.exam-side-title .back:hover{',
      '  background:color-mix(in srgb, var(--eg-fg) 8%, transparent);color:var(--eg-fg)}',

      '.exam-side-btn{display:flex;align-items:center;gap:9px;width:100%;border:0;cursor:pointer;background:transparent;',
      '  color:var(--eg-fg);border-radius:9px;padding:7px 8px;margin-bottom:2px;font-size:12.5px;text-align:left;position:relative;',
      '  transition:background .18s ease,color .18s ease,transform .18s ease}',
      '.exam-side-btn:hover{background:color-mix(in srgb, var(--eg-brand) 10%, transparent);',
      '  color:var(--eg-brand);transform:translateX(2px)}',
      '.exam-side-btn .ico{width:27px;height:27px;border-radius:8px;flex:none;display:flex;align-items:center;justify-content:center;font-size:14px}',
      '.exam-side-btn .lbl{display:flex;flex-direction:column;line-height:1.25}',
      '.exam-side-btn .lbl b{font-weight:600}',
      '.exam-side-btn .lbl small{font-size:10px;color:var(--eg-fg3);font-weight:400}',
      '.exam-side-foot{font-size:10px;color:var(--eg-fg3);text-align:center;margin-top:7px;padding-top:8px;border-top:1px solid var(--eg-line)}',

      '.exam-side-tip{position:absolute;left:calc(100% + 8px);top:50%;transform:translateY(-50%);width:200px;',
      '  padding:9px 11px;border-radius:9px;font-size:11px;line-height:1.55;color:var(--eg-fg2);',
      '  background:var(--eg-bg);border:1px solid var(--eg-line);box-shadow:0 8px 24px rgba(0,0,0,.12);',
      '  z-index:2;animation:eg-tip-in .16s ease}',
      '@keyframes eg-tip-in{from{opacity:0;transform:translateY(-50%) translateX(-4px)}to{opacity:1;transform:translateY(-50%)}}',

      '.exam-side-card.is-about{width:280px}',
      '.exam-about{margin:1px 2px 10px;padding:12px;border-radius:10px;max-height:64vh;overflow:auto;',
      '  background:color-mix(in srgb, var(--eg-fg) 4%, transparent);border:1px solid var(--eg-line)}',
      '.exam-about-hero{font-size:12.5px;font-weight:700;color:var(--eg-brand);line-height:1.5}',
      '.exam-about-hero small{display:block;font-weight:400;color:var(--eg-fg3);font-size:10.5px;line-height:1.5;margin-top:3px}',
      '.exam-about h5{font-size:11px;font-weight:650;color:var(--eg-fg2);margin:11px 0 5px;letter-spacing:.02em}',
      '.exam-about p,.exam-about li{font-size:11px;line-height:1.6;color:var(--eg-fg2);margin:0}',
      '.exam-about ul{margin:0;padding-left:15px}',
      '.exam-about li{margin:1px 0}',
      '.exam-about .flow span{color:var(--eg-brand);font-weight:600}',
      '.exam-about-close{display:block;margin:10px 0 0 auto;border:0;cursor:pointer;background:transparent;',
      '  color:var(--eg-fg3);font-size:10.5px;padding:2px 4px;border-radius:5px;transition:color .16s ease}',
      '.exam-about-close:hover{color:var(--eg-brand)}',

      // 参数面板
      '.exam-param{display:flex;flex-direction:column;gap:8px;max-height:62vh;overflow:auto;padding:2px 2px 4px}',
      '.exam-param .eg-explain{font-size:11px;line-height:1.55;color:var(--eg-fg2);',
      '  background:color-mix(in srgb, var(--eg-brand) 9%, transparent);',
      '  border-left:3px solid var(--eg-brand);border-radius:0 8px 8px 0;',
      '  padding:7px 9px;margin-bottom:2px}',
      '.exam-param .eg-field{display:flex;flex-direction:column;gap:4px}',
      '.exam-param .eg-label{font-size:11px;font-weight:600;color:var(--eg-fg2)}',
      '.exam-param select,.exam-param input[type=text]{width:100%;box-sizing:border-box;font-size:12px;color:var(--eg-fg);',
      '  background:color-mix(in srgb, var(--eg-fg) 4%, transparent);border:1px solid var(--eg-line);border-radius:8px;',
      '  padding:6px 8px;outline:none}',
      '.exam-param select:focus,.exam-param input[type=text]:focus{border-color:var(--eg-brand)}',
      '.exam-param select:disabled,.exam-param input:disabled{opacity:.5}',
      '.eg-seg{display:flex;flex-wrap:wrap;gap:4px}',
      '.eg-seg-btn{border:1px solid var(--eg-line);background:transparent;color:var(--eg-fg2);border-radius:7px;',
      '  font-size:11.5px;padding:5px 9px;cursor:pointer;transition:all .14s ease}',
      '.eg-seg-btn:hover{border-color:var(--eg-brand);color:var(--eg-brand)}',
      '.eg-seg-btn.on{background:color-mix(in srgb, var(--eg-brand) 14%, transparent);',
      '  border-color:var(--eg-brand);color:var(--eg-brand);font-weight:600}',
      '.eg-grade-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px}',
      '.eg-chk{display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--eg-fg2);cursor:pointer;',
      '  padding:5px 6px;border-radius:7px;border:1px solid var(--eg-line);transition:all .14s ease}',
      '.eg-chk input{accent-color:#6366f1}',
      '.eg-chk.on{border-color:var(--eg-brand);color:var(--eg-brand);background:color-mix(in srgb, var(--eg-brand) 8%, transparent)}',
      '.eg-range{width:100%;accent-color:#6366f1}',
      '.eg-hint{font-size:10px;color:var(--eg-fg3);line-height:1.5}',

      // 拖拽模仿投放区
      '.eg-mimic{display:flex;flex-direction:column;gap:6px}',
      '.eg-mimic-zone{border:2px dashed color-mix(in srgb, var(--eg-brand) 45%, transparent);',
      '  border-radius:11px;padding:13px 10px;display:flex;flex-direction:column;align-items:center;gap:3px;',
      '  text-align:center;color:var(--eg-fg2);background:color-mix(in srgb, var(--eg-brand) 5%, transparent);',
      '  transition:border-color .16s ease,background .16s ease}',
      '.eg-mimic-zone.dragging{border-color:var(--eg-brand);',
      '  background:color-mix(in srgb, var(--eg-brand) 13%, transparent)}',
      '.eg-mimic-zone-ico{font-size:22px;line-height:1}',
      '.eg-mimic-zone-title{font-size:12px;font-weight:650;color:var(--eg-fg)}',
      '.eg-mimic-zone-sub{font-size:10px;color:var(--eg-fg3)}',
      '.eg-mimic-zone-has{font-size:10px;color:var(--eg-brand);font-weight:600;margin-top:2px}',
      '.exam-param .eg-textarea{width:100%;box-sizing:border-box;min-height:88px;resize:vertical;',
      '  font-size:11px;line-height:1.55;color:var(--eg-fg);',
      '  background:color-mix(in srgb, var(--eg-fg) 4%, transparent);border:1px solid var(--eg-line);',
      '  border-radius:8px;padding:6px 8px;outline:none;font-family:inherit}',
      '.exam-param .eg-textarea:focus{border-color:var(--eg-brand)}',

      // 知识点清单：章节选中后列出该章全部知识点 + 题型徽章（多选）
      '.eg-point-list{display:flex;flex-direction:column;gap:4px;max-height:190px;overflow:auto;',
      '  padding:5px;border-radius:9px;background:color-mix(in srgb,var(--eg-fg) 3%,transparent);',
      '  border:1px solid var(--eg-line)}',
      '.eg-point-item{display:flex;align-items:center;gap:6px;flex-wrap:wrap;cursor:pointer;',
      '  padding:5px 6px;border-radius:7px;border:1px solid transparent;',
      '  font-size:11px;color:var(--eg-fg2);transition:all .14s ease}',
      '.eg-point-item:hover{background:color-mix(in srgb,var(--eg-brand) 7%,transparent)}',
      '.eg-point-item.on{border-color:var(--eg-brand);',
      '  background:color-mix(in srgb,var(--eg-brand) 10%,transparent);color:var(--eg-fg)}',
      '.eg-point-item input{accent-color:#6366f1;flex:none}',
      '.eg-point-name{font-weight:550;flex:1 1 auto;min-width:0}',
      '.eg-point-types{display:inline-flex;gap:3px;flex:none}',
      '.eg-badge{font-style:normal;font-size:9px;line-height:1;padding:2px 5px;border-radius:5px;',
      '  background:color-mix(in srgb,var(--eg-fg) 8%,transparent);color:var(--eg-fg3);',
      '  border:1px solid var(--eg-line);font-weight:500;white-space:nowrap}',
      '.eg-point-item.on .eg-badge{background:color-mix(in srgb,var(--eg-brand) 14%,transparent);',
      '  color:var(--eg-brand);border-color:color-mix(in srgb,var(--eg-brand) 30%,transparent)}',
      '.exam-param .eg-submit{width:100%;border:0;cursor:pointer;border-radius:9px;padding:9px 0;font-size:13px;font-weight:650;',
      '  color:#fff;background:linear-gradient(135deg,#6366f1,#8b5cf6);box-shadow:0 4px 14px rgba(99,102,241,.28);',
      '  transition:transform .14s ease,box-shadow .14s ease}',
      '.exam-param .eg-submit:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(99,102,241,.34)}',

      '.exam-side-mini{position:fixed;z-index:2147483000;width:44px;height:44px;border-radius:50%;',
      '  cursor:pointer;font-size:18px;color:var(--dsw-alias-brand-primary,#6366f1);',
      '  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.22));',
      '  background:color-mix(in srgb, var(--dsw-alias-bg-base, var(--eg-host-bg, #fff)) 90%, transparent);',
      '  box-shadow:0 6px 18px rgba(0,0,0,.12);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}',
    ].join('\n')
    var el = document.createElement('style')
    el.id = STYLE_ID
    el.textContent = css
    document.head.appendChild(el)
  }

  /* ---------------- 主题探测与同步 ---------------- */

  function parseColor(s) {
    var m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/i.exec(s || '')
    if (!m) return null
    return {
      rgb: [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)],
      a: m[4] !== undefined ? parseFloat(m[4]) : 1,
    }
  }

  function luminance(rgb) {
    if (!rgb) return null
    var c = []
    for (var i = 0; i < 3; i++) {
      var v = rgb[i] / 255
      c.push(v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
    }
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }

  function detectDark() {
    try {
      var b = document.body
      var h = document.documentElement
      if (b && b.hasAttribute && b.hasAttribute('data-ds-dark-theme')) return true
      if (b && b.classList && (b.classList.contains('dark') || b.classList.contains('dark-theme'))) return true
      if (h && h.classList && h.classList.contains('dark')) return true
      var dt = (b && b.getAttribute && b.getAttribute('data-theme')) ||
               (h && h.getAttribute && h.getAttribute('data-theme')) || ''
      if (dt === 'dark') return true
      if (b && window.getComputedStyle) {
        var info = parseColor(window.getComputedStyle(b).backgroundColor)
        if (info && info.a > 0.5) {
          var L = luminance(info.rgb)
          if (L !== null && L < 0.35) return true
          if (L !== null && L > 0.75) return false
        }
      }
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return true
    } catch (e) { /* ignore */ }
    return false
  }

  function syncTheme() {
    var root = document.documentElement
    if (!root || !root.style) return
    var dark = detectDark()
    try { root.setAttribute('data-eg-theme', dark ? 'dark' : 'light') } catch (e) {}

    var bg = '', fg = ''
    try {
      if (document.body && window.getComputedStyle) {
        var cs = window.getComputedStyle(document.body)
        bg = cs.backgroundColor || ''
        fg = cs.color || ''
      }
    } catch (e) {}
    var bi = parseColor(bg)
    root.style.setProperty('--eg-host-bg', (bi && bi.a > 0.05) ? bg : (dark ? '#18181b' : '#ffffff'))
    var fi = parseColor(fg)
    root.style.setProperty('--eg-host-fg', (fi && fi.a > 0.05) ? fg : (dark ? '#f4f4f5' : '#18181b'))
  }

  function watchTheme() {
    syncTheme()
    try {
      var mo = new MutationObserver(function () { syncTheme() })
      if (document.documentElement) {
        mo.observe(document.documentElement, { attributes: true,
          attributeFilter: ['class', 'data-theme', 'data-ds-dark-theme', 'style'] })
      }
      if (document.body) {
        mo.observe(document.body, { attributes: true,
          attributeFilter: ['class', 'data-theme', 'data-ds-dark-theme', 'style'] })
      }
    } catch (e) { /* ignore */ }
    try {
      if (window.matchMedia) {
        var mq = window.matchMedia('(prefers-color-scheme: dark)')
        function onMq() { syncTheme() }
        if (mq.addEventListener) mq.addEventListener('change', onMq)
        else if (mq.addListener) mq.addListener(onMq)
      }
    } catch (e) { /* ignore */ }
  }

  /* ---------------- 与 host 通信 ---------------- */

  function tokenFromLocation() {
    try { return new URL(location.href).searchParams.get('token') || '' } catch (e) { return '' }
  }

  function httpJson(url) {
    return fetch(url, { headers: { 'x-exam-token': tokenFromLocation() } })
      .then(function (r) { return r.ok ? r.json() : null })
      .catch(function () { return null })
  }

  function readEnabled() {
    return httpJson('/exam-bank/api/stats')
      .then(function (j) { return j && typeof j.enabled === 'boolean' ? j.enabled : state.enabled })
      .catch(function () { return state.enabled })
  }

  function toggleEnabled() {
    if (state.busy) return
    state.busy = true
    fetch('/exam-bank/api/toggle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-exam-token': tokenFromLocation() },
      body: JSON.stringify({ enabled: !state.enabled }),
    })
      .then(function (r) { return r.json() })
      .then(function (j) { state.enabled = !!j.enabled })
      .catch(function () { /* 保持原状态 */ })
      .then(function () {
        state.busy = false
        renderEntry()
        emitState()
      })
  }

  /* ---------------- 侧栏入口（DOM 方案，仅作开关） ---------------- */

  // 侧栏锚点文案：DSH 每次改版文案可能变，多备几个候选，找不到也不崩（只是没有左侧开关，右侧圆标仍可用）。
  var ANCHOR_TEXTS = ['插件', '自动化任务', '更多', '扩展', '工具', 'Extensions', 'Plugins']

  function findAnchor() {
    var nodes = document.querySelectorAll('a,button,div,li,span')
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i]
      if (!el.offsetParent) continue
      if (el.children.length > 2) continue
      var t = (el.textContent || '').trim()
      if (ANCHOR_TEXTS.indexOf(t) === -1) continue
      var row = el.closest('a,button,[role="button"],li') || el
      if (row && row.offsetParent) return { node: row, label: t }
    }
    return null
  }

  function ensureEntry() {
    if (document.querySelector('[' + ENTRY_ATTR + ']')) return true
    var found = findAnchor()
    if (!found) return false
    var row = found.node
    var clone = row.cloneNode(true)
    clone.removeAttribute('id')
    clone.setAttribute(ENTRY_ATTR, '1')
    var labelHost = null
    var walk = clone.querySelectorAll('*')
    for (var i = 0; i < walk.length; i++) {
      var n = walk[i]
      if (n.children.length === 0 && (n.textContent || '').trim() === found.label) { labelHost = n; break }
    }
    if (labelHost) labelHost.textContent = '出题'
    else clone.textContent = '出题'
    var dot = document.createElement('span')
    dot.className = 'exam-gen-dot'
    clone.appendChild(dot)
    clone.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation()
      // 左侧入口 = 设置入口：点开即展开设置面板（里面有关闭/开启 + 全部说明）。
      // 若插件当前关闭，先打开后端开关，再通知右侧面板展开设置。
      if (!state.enabled) toggleEnabled()
      try { window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT)) } catch (e) {}
    })
    row.parentNode.insertBefore(clone, row.nextSibling)
    renderEntry()
    return true
  }

  function renderEntry() {
    var el = document.querySelector('[' + ENTRY_ATTR + ']')
    if (!el) return
    el.classList.toggle('is-off', !state.enabled)
    el.title = state.enabled ? '出题插件：已启动（右侧显示功能面板）' : '出题插件：已关闭'
  }

  /* ---------------- 静默发送 ---------------- */

  function findInput() {
    var list = document.querySelectorAll('div[contenteditable="true"],textarea')
    for (var i = 0; i < list.length; i++) if (list[i].offsetParent) return list[i]
    return null
  }

  function typeInto(el, text) {
    el.focus()
    var dt = new DataTransfer()
    dt.setData('text/plain', text)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }

  function fallbackPaste(text) {
    setTimeout(function () { var input = findInput(); if (input) typeInto(input, text) }, 120)
  }

  /** 把组合好的指令静默发给模型（输入框不出现任何文字）。 */
  function sendPrompt(ctx, sessionId, text) {
    var sessions = ctx && ctx.sessions
    var binding = sessions && typeof sessions.binding === 'function' ? sessions.binding(sessionId) : null
    var session = binding && binding.session
    if (session && typeof session.prompt === 'function') {
      try {
        var p = session.prompt([{ type: 'text', text: text }], 'queue')
        if (p && typeof p.catch === 'function') p.catch(function () { fallbackPaste(text) })
        return
      } catch (e) { /* 走兜底 */ }
    }
    fallbackPaste(text)
  }

  /* ---------------- 目录接口（知识点级联数据源） ---------------- */

  function catalogUrl(q) {
    var base = '/exam-bank/api/catalog'
    var parts = []
    for (var k in q) {
      if (q[k]) parts.push(k + '=' + encodeURIComponent(q[k]))
    }
    return parts.length ? base + '?' + parts.join('&') : base
  }

  /* ---------------- 组合指令（发给模型） ---------------- */

  function typeLabel(t) {
    if (t === 'choice') return '选择'
    if (t === 'multi') return '多选'
    if (t === 'fill') return '填空'
    if (t === 'solve') return '解答'
    return '混合（选择、填空、解答）'
  }

  function gradeStr(grades) {
    var out = []
    for (var i = 0; i < GRADE_ORDER.length; i++) if (grades[GRADE_ORDER[i]]) out.push(GRADE_ORDER[i])
    return out.length ? out.join('、') : '初一'
  }

  function rangeStr(p) {
    var s = ''
    if (p.book) s += p.book
    if (p.chapter) s += (s ? '·' : '') + p.chapter
    // 多选知识点：全部列进范围；否则退回单选 point
    if (p.points && p.points.length) s += (s ? '·' : '') + p.points.join('·')
    else if (p.point) s += (s ? '·' : '') + p.point
    return s || '本学期核心章节'
  }

  function buildBrief(featureKey, p) {
    var grades = gradeStr(p.grades)
    var subject = p.subject
    var range = rangeStr(p)
    var stage = p.stage === '高考' ? '高考' : (p.stage === '中考' ? '中考' : '')
    var diff = p.difficulty || '中等'
    var ans = p.withAnswer ? '附答案' : '不附答案'

    if (featureKey === 'drill') {
      return '做一份' + subject + '专项突破练习。年级：' + grades + '。范围：' + range +
        '。题量：' + p.count + '道。难度：' + diff + '。题型：' + typeLabel(p.types) + '。答案：' + ans + '。'
    }
    if (featureKey === 'lesson') {
      return '写一份' + subject + '教学讲义。年级：' + grades + '。范围：' + range + '。难度：' + diff + '。'
    }
    if (featureKey === 'graph') {
      return '梳理' + subject + '知识图谱。年级：' + grades + '。范围：' + range + '。'
    }
    if (featureKey === 'sync') {
      return '出一份' + subject + '教材同步练习。年级：' + grades + '。版本：' + p.textbook +
        '。范围：' + range + '。题量：' + p.count + '道。难度：' + diff + '。答案：' + ans + '。'
    }
    if (featureKey === 'mimic') {
      var doc = (p.sourceText || '').trim()
      var docBlock = doc ? '\n\n【文档内容，作为 sourceText 原样传入工具】\n' + doc.slice(0, 12000) : ''
      return '用「拖拽模仿」把下面文档 1:1 模仿成一张新卷，调用工具 mimic_from_document。' +
        '年级：' + grades + '。学科：' + subject + '。难度：' + diff + '。' +
        '要求：识别文档里的题号、题干、选项、答案与数字，保持题型、题量、小问结构不变，只改数字与情境。' + docBlock
    }
    // paper（默认）
    return '出一套' + (stage ? stage : '') + subject + '试卷。年级：' + grades +
      '。范围：' + range + '。题量：' + p.count + '道。难度：' + diff +
      '。题型：' + typeLabel(p.types) + '。答案：' + ans + '。'
  }

  /* ---------------- 使用说明 / 设置面板 ---------------- */

  function renderAbout(R, onClose) {
    var e = R.createElement
    var flow = ['规则解析', '卷面规格', '题库锚定', '模型只编题', '本地校验', 'PDF 排版']
    var save = ['确定性工作下沉本地：排版/编号/校验/统计不耗模型 token',
                '骨架注入：只给卷面骨架与约束，不喂大段范文',
                '约束输出：结构化指令让模型只编题，减少废话往返',
                '题库复用：锚定已有题目，避免重复生成']
    return e('div', { className: 'exam-about' },
      e('div', { className: 'exam-about-hero' },
        '用更少的 token，生成更高质量的题目',
        e('small', null, '把确定性工作交给本地，模型专注编题。参数卡纯本地渲染，点开即现。')
      ),
      e('h5', null, '六个功能'),
      e('ul', null, FEATURES.map(function (f) {
        return e('li', { key: f.key }, f.label + ' — ' + f.desc)
      })),
      e('h5', null, '工作原理'),
      e('p', { className: 'flow' },
        flow.map(function (step, i) {
          return i === 0 ? step : e('span', { key: i }, ' → ' + step)
        })
      ),
      e('h5', null, '为什么省 token'),
      e('ul', null, save.map(function (s, i) { return e('li', { key: i }, s) })),
      e('button', { className: 'exam-about-close', onClick: onClose }, '收起介绍 ×')
    )
  }

  /* ---------------- 参数面板（纯客户端，零延迟） ---------------- */

  function segControl(R, options, value, onChange) {
    return R.createElement('div', { className: 'eg-seg' },
      options.map(function (o) {
        var active = o.value === value
        return R.createElement('button', {
          key: o.value, type: 'button',
          className: 'eg-seg-btn' + (active ? ' on' : ''),
          onClick: function () { onChange(o.value) },
        }, o.label)
      })
    )
  }

  function gradeGrid(R, grades, onToggle) {
    return R.createElement('div', { className: 'eg-grade-grid' },
      GRADE_ORDER.map(function (g) {
        var on = !!grades[g]
        return R.createElement('label', { key: g, className: 'eg-chk' + (on ? ' on' : '') },
          R.createElement('input', { type: 'checkbox', checked: on, onChange: function () { onToggle(g) } }),
          R.createElement('span', null, g)
        )
      })
    )
  }

  function selectField(R, label, options, value, onChange, disabled) {
    return R.createElement('label', { className: 'eg-field' },
      R.createElement('span', { className: 'eg-label' }, label),
      R.createElement('select', {
        value: value, disabled: !!disabled,
        onChange: function (e) { onChange(e.target.value) },
      },
        R.createElement('option', { value: '' }, '请选择'),
        options.map(function (o) { return R.createElement('option', { key: o, value: o }, o) })
      )
    )
  }

  function sliderField(R, label, value, min, max, onChange) {
    return R.createElement('label', { className: 'eg-field' },
      R.createElement('span', { className: 'eg-label' }, label + '：' + value + ' 题'),
      R.createElement('input', {
        className: 'eg-range', type: 'range', min: min, max: max, value: value,
        onChange: function (e) { onChange(parseInt(e.target.value, 10)) },
      })
    )
  }

  var TYPE_BADGE = { choice: '选择', multi: '多选', fill: '填空', solve: '解答', exp: '实验' }
  function typeBadge(t) { return TYPE_BADGE[t] || t }

  /** 知识点清单：章节选中后列出该章全部知识点 + 题型徽章，可多选。 */
  function pointList(R, points, selected, onToggle) {
    if (!points || !points.length) {
      return R.createElement('div', { className: 'eg-hint' }, '该章节暂无知识点数据。')
    }
    return R.createElement('div', { className: 'eg-point-list' },
      points.map(function (p) {
        var name = typeof p === 'string' ? p : p.name
        var types = (p && p.types) || []
        var on = !!selected[name]
        return R.createElement('label', {
          key: name, className: 'eg-point-item' + (on ? ' on' : ''),
          title: '点选「' + name + '」加入出卷范围',
        },
          R.createElement('input', { type: 'checkbox', checked: on, onChange: function () { onToggle(name) } }),
          R.createElement('span', { className: 'eg-point-name' }, name),
          R.createElement('span', { className: 'eg-point-types' },
            types.map(function (t) {
              return R.createElement('em', { key: t, className: 'eg-badge tb-' + t }, typeBadge(t))
            })
          )
        )
      })
    )
  }

  function ParamPanel(props) {
    if (!ReactLib) return null
    var R = ReactLib
    var useState = R.useState
    var useEffect = R.useEffect
    var useRef = R.useRef

    var featureKey = props.feature

    // —— 基础字段 ——
    var subj = useState('数学'); var subject = subj[0]; var setSubject = subj[1]
    var gr = useState({ 初一: true, 初二: false, 初三: false, 高一: false, 高二: false, 高三: false })
    var grades = gr[0]; var setGrades = gr[1]
    var st = useState(''); var stage = st[0]; var setStage = st[1]
    var tb = useState('人教版'); var textbook = tb[0]; var setTextbook = tb[1]
    var bk = useState(''); var book = bk[0]; var setBook = bk[1]
    var ch = useState(''); var chapter = ch[0]; var setChapter = ch[1]
    var pt = useState(''); var point = pt[0]; var setPoint = pt[1]
    // 知识点清单多选（name -> true），带题型徽章
    var sp = useState({}); var selectedPoints = sp[0]; var setSelectedPoints = sp[1]
    var cnt = useState(10); var count = cnt[0]; var setCount = cnt[1]
    var df = useState('中等'); var difficulty = df[0]; var setDifficulty = df[1]
    var ty = useState('mixed'); var types = ty[0]; var setTypes = ty[1]
    var an = useState(true); var withAnswer = an[0]; var setWithAnswer = an[1]

    // —— 拖拽模仿专用状态 ——
    var src = useState(''); var sourceText = src[0]; var setSourceText = src[1]
    var dr = useState(false); var dragging = dr[0]; var setDragging = dr[1]
    var dz = useState(''); var dropZoneNote = dz[0]; var setDropZoneNote = dz[1]

    // —— 级联数据 ——
    var booksS = useState([]); var books = booksS[0]; var setBooks = booksS[1]
    var chaptersS = useState([]); var chapters = chaptersS[0]; var setChapters = chaptersS[1]
    var pointsS = useState([]); var points = pointsS[0]; var setPoints = pointsS[1]

    var firstGrade = ''
    for (var gi = 0; gi < GRADE_ORDER.length; gi++) {
      if (grades[GRADE_ORDER[gi]]) { firstGrade = GRADE_ORDER[gi]; break }
    }
    var gradeCount = 0
    for (var gi2 = 0; gi2 < GRADE_ORDER.length; gi2++) if (grades[GRADE_ORDER[gi2]]) gradeCount++
    var singleGrade = gradeCount === 1

    function loadBooks() {
      // 科目/年级/版本一变，整条级联下游必须清空：否则旧 book 会拿着新版本去查章节，
      // 拿到过期章节甚至空列表。先清再 load。
      setBook(''); setChapter(''); setPoint(''); setChapters([]); setPoints([])
      if (!singleGrade) { setBooks([]); return }
      httpJson(catalogUrl({ subject: subject, grade: firstGrade, edition: textbook }))
        .then(function (j) { setBooks((j && j.books) || []) })
    }
    function loadChapters() {
      if (!book) { setChapters([]); setPoints([]); setChapter(''); setPoint(''); return }
      httpJson(catalogUrl({ subject: subject, grade: firstGrade, edition: textbook, book: book }))
        .then(function (j) { setChapters((j && j.chapters) || []) })
    }
    function loadPoints() {
      if (!chapter) { setPoints([]); setPoint(''); setSelectedPoints({}); return }
      httpJson(catalogUrl({ subject: subject, grade: firstGrade, edition: textbook, book: book, chapter: chapter }))
        .then(function (j) {
          // 保留 {name, types}，清单要显示每个知识点的题型徽章
          setPoints((j && j.points) || [])
        })
    }

    useEffect(function () { loadBooks() }, [subject, firstGrade, textbook, singleGrade])
    useEffect(function () { loadChapters() }, [book])
    useEffect(function () { loadPoints() }, [chapter])

    function toggleGrade(g) {
      var next = {}
      for (var i = 0; i < GRADE_ORDER.length; i++) next[GRADE_ORDER[i]] = grades[GRADE_ORDER[i]]
      next[g] = !next[g]
      setGrades(next)
      // 年级变化后重置级联选择
      setBook(''); setChapter(''); setPoint(''); setSelectedPoints({})
    }

    function togglePoint(name) {
      var next = {}
      for (var k in selectedPoints) if (Object.prototype.hasOwnProperty.call(selectedPoints, k)) next[k] = selectedPoints[k]
      next[name] = !next[name]
      setSelectedPoints(next)
      setPoint(name) // 同时更新单选 point，兼容 buildBrief 的 rangeStr
    }

    // 选中的知识点名字数组（按目录顺序）
    function chosenPointNames() {
      var arr = []
      for (var i = 0; i < points.length; i++) if (selectedPoints[points[i].name]) arr.push(points[i].name)
      return arr
    }

    function onSubmit() {
      var brief = buildBrief(featureKey, {
        grades: grades, subject: subject, stage: stage, textbook: textbook,
        book: book, chapter: chapter, point: point,
        points: chosenPointNames(), count: count,
        difficulty: difficulty, types: types, withAnswer: withAnswer,
        sourceText: sourceText,
      })
      if (props.onClose) props.onClose()
      if (props.onSubmit) props.onSubmit(brief)
    }

    function readDroppedFile(file) {
      // 只读文本：txt/md/csv 直接读；docx/pdf 的文本读不出来（FileReader 读二进制），
      // 提示用户把文字粘贴进下方 textarea。其它文本类后缀也照读。
      var name = (file && file.name) || ''
      var ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
      var okExt = { txt: 1, md: 1, csv: 1, text: 1, json: 1, markdown: 1 }
      if (okExt[ext]) {
        var reader = new FileReader()
        reader.onload = function () {
          var text = typeof reader.result === 'string' ? reader.result : ''
          if (text) {
            setSourceText(text)
            setDropZoneNote('已读入 ' + name + '（' + text.length + ' 字）')
          } else {
            setDropZoneNote('文件为空，请粘贴文字。')
          }
        }
        reader.onerror = function () {
          setDropZoneNote('读取失败，请粘贴文字。')
        }
        reader.readAsText(file, 'utf-8')
        return
      }
      setDropZoneNote('只支持 .txt/.md/.csv；「' + name + '」请把文字粘进下方文本框。')
    }

    var needRange = featureKey !== 'lesson' || true // 讲义也允许选范围
    var needCount = featureKey === 'paper' || featureKey === 'drill' || featureKey === 'sync'
    var needTypes = featureKey === 'paper' || featureKey === 'drill'

    // 拖拽投放区 DOM ref：必须在原生 capture 阶段抢先 stopPropagation，
    // 才能在 DSH 附件处理器（document 冒泡阶段 preventDefault）接管全页 drop 之前拦住事件。
    var dropRef = useRef(null)
    useEffect(function () {
      if (featureKey !== 'mimic' || !dropRef.current) return
      var el = dropRef.current
      function over(e) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); setDragging(true) }
      function leave() { setDragging(false) }
      function drop(e) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation()
        setDragging(false)
        var files = e.dataTransfer && e.dataTransfer.files
        if (files && files.length) readDroppedFile(files[0])
      }
      el.addEventListener('dragover', over, true)
      el.addEventListener('dragleave', leave, true)
      el.addEventListener('drop', drop, true)
      return function () {
        el.removeEventListener('dragover', over, true)
        el.removeEventListener('dragleave', leave, true)
        el.removeEventListener('drop', drop, true)
      }
    })

    var mimicDrop = featureKey === 'mimic'
      ? R.createElement('div', { className: 'eg-mimic' },
          R.createElement('div', {
            ref: dropRef,
            className: 'eg-mimic-zone' + (dragging ? ' dragging' : ''),
          },
            R.createElement('div', { className: 'eg-mimic-zone-ico' }, '📄'),
            R.createElement('div', { className: 'eg-mimic-zone-title' }, dragging ? '松手读入文档' : '把试卷/题目文档拖到这里'),
            R.createElement('div', { className: 'eg-mimic-zone-sub' }, '支持 .txt / .md / .csv；PDF、Word 请粘贴文字'),
            sourceText
              ? R.createElement('div', { className: 'eg-mimic-zone-has' }, '已载入 ' + sourceText.length + ' 字')
              : null
          ),
          R.createElement('label', { className: 'eg-field' },
            R.createElement('span', { className: 'eg-label' }, '或直接粘贴题目文字（无文档时）'),
            R.createElement('textarea', {
              className: 'eg-textarea', rows: 6, value: sourceText,
              placeholder: '粘贴整张试卷或若干道题目……\n例如：\n1. 小明有 12 个苹果，吃了 5 个，还剩几个？\nA. 6  B. 7  C. 8  D. 9\n答案：B',
              onChange: function (e) { setSourceText(e.target.value) },
            })
          ),
          dropZoneNote
            ? R.createElement('div', { className: 'eg-hint' }, dropZoneNote)
            : null
        )
      : null

    var children = [
      props.explain
        ? R.createElement('div', { className: 'eg-explain' }, props.explain)
        : null,
      mimicDrop,
      R.createElement('div', { className: 'eg-field' },
        R.createElement('span', { className: 'eg-label' }, '科目'),
        segControl(R, SUBJECT_ORDER.map(function (s) { return { label: s, value: s } }), subject, setSubject)
      ),
      R.createElement('div', { className: 'eg-field' },
        R.createElement('span', { className: 'eg-label' }, '年级（可多选，跨年级组卷）'),
        gradeGrid(R, grades, toggleGrade)
      ),
      R.createElement('div', { className: 'eg-field' },
        R.createElement('span', { className: 'eg-label' }, '学段'),
        segControl(R, [{ label: '不限', value: '' }, { label: '中考', value: '中考' }, { label: '高考', value: '高考' }], stage, setStage)
      ),
    ]

    if (needRange) {
      children.push(
        selectField(R, '教材版本', EDITION_ORDER, textbook, setTextbook),
        singleGrade
          ? selectField(R, '册别（上册/下册/必修…）', books, book, setBook)
          : R.createElement('div', { className: 'eg-hint' }, '多选年级时出跨年级卷，册别/章节自动留空。'),
        singleGrade && book
          ? selectField(R, '章节', chapters, chapter, setChapter)
          : null,
        singleGrade && chapter
          ? R.createElement('div', { className: 'eg-field' },
              R.createElement('span', { className: 'eg-label' },
                '知识点清单（点选要考的点，括号为常见题型）'),
              pointList(R, points, selectedPoints, togglePoint)
            )
          : null
      )
    }

    if (needCount) children.push(sliderField(R, '题量', count, 1, 30, setCount))
    children.push(
      R.createElement('div', { className: 'eg-field' },
        R.createElement('span', { className: 'eg-label' }, '难度'),
        segControl(R, [{ label: '基础', value: '基础' }, { label: '中等', value: '中等' }, { label: '拔高', value: '拔高' }], difficulty, setDifficulty)
      )
    )
    if (needTypes) {
      children.push(
        R.createElement('div', { className: 'eg-field' },
          R.createElement('span', { className: 'eg-label' }, '题型'),
          segControl(R, [
            { label: '混合', value: 'mixed' }, { label: '单选', value: 'choice' }, { label: '多选', value: 'multi' },
            { label: '填空', value: 'fill' }, { label: '解答', value: 'solve' },
          ], types, setTypes)
        )
      )
    }
    if (featureKey === 'paper') {
      children.push(
        R.createElement('div', { className: 'eg-field' },
          R.createElement('span', { className: 'eg-label' }, '答案页'),
          segControl(R, [{ label: '附答案', value: true }, { label: '不附', value: false }], withAnswer, setWithAnswer)
        )
      )
    }

    children.push(R.createElement('button', { className: 'eg-submit', type: 'button', onClick: onSubmit }, '生成'))

    return R.createElement('div', { className: 'exam-param' }, children)
  }

  /* ---------------- 右侧悬浮卡片（React slot 组件） ---------------- */

  function SideCard(props) {
    if (!ReactLib) return null
    var R = ReactLib
    var useState = R.useState
    var useEffect = R.useEffect

    var on = useState(state.enabled)
    var enabled = on[0]
    var setEnabled = on[1]
    var col = useState(true)
    var collapsed = col[0]
    var setCollapsed = col[1]
    var ab = useState(false)
    var showAbout = ab[0]
    var setShowAbout = ab[1]
    var tip = useState('')
    var tipKey = tip[0]
    var setTipKey = tip[1]
    // 当前打开的参数面板（null = 未打开）
    var act = useState('')
    var activeFeature = act[0]
    var setActiveFeature = act[1]

    var posRef = R.useRef(readPos() || { x: window.innerWidth - 248, y: 74 })
    var pos = useState(posRef.current)
    var cardPos = pos[0]
    var setCardPos = pos[1]

    useEffect(function () {
      function handler(e) {
        var v = e && e.detail && typeof e.detail.enabled === 'boolean' ? e.detail.enabled : state.enabled
        setEnabled(v)
        if (!v) { setCollapsed(true); setShowAbout(false); setActiveFeature('') }
      }
      window.addEventListener(STATE_EVENT, handler)
      return function () { window.removeEventListener(STATE_EVENT, handler) }
    }, [])

    // 左侧「出题 / 设置」入口点击 → 展开右侧面板的设置页（展开大卡片 + 显示说明）。
    useEffect(function () {
      function onOpen() {
        setEnabled(true)
        setCollapsed(false)
        setActiveFeature('')
        setShowAbout(true)
      }
      window.addEventListener(OPEN_SETTINGS_EVENT, onOpen)
      return function () { window.removeEventListener(OPEN_SETTINGS_EVENT, onOpen) }
    }, [])

    function beginDrag(e) {
      var target = e && e.target
      if (target && (target.closest('.info') || target.closest('.min') || target.closest('.back'))) return
      if (e.button !== undefined && e.button !== 0) return
      var startX = e.clientX, startY = e.clientY
      var orig = posRef.current
      function onMove(ev) {
        var nx = Math.max(4, Math.min(window.innerWidth - 40, orig.x + (ev.clientX - startX)))
        var ny = Math.max(4, Math.min(window.innerHeight - 40, orig.y + (ev.clientY - startY)))
        posRef.current = { x: nx, y: ny }
        setCardPos({ x: nx, y: ny })
      }
      function onUp() {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        writePos(posRef.current.x, posRef.current.y)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    }

    if (!enabled) return null

    var posStyle = { left: cardPos.x + 'px', top: cardPos.y + 'px' }

    var feature = null
    if (activeFeature) {
      for (var fi = 0; fi < FEATURES.length; fi++) if (FEATURES[fi].key === activeFeature) feature = FEATURES[fi]
    }

    var card
    if (collapsed) {
      card = R.createElement(
        'button', { className: 'exam-side-mini', style: posStyle, title: '展开出题助手',
          onMouseDown: beginDrag,
          onClick: function () { setCollapsed(false) } }, '✦'
      )
    } else if (feature) {
      // 参数面板
      card = R.createElement(
        'div', { className: 'exam-side-card', style: posStyle },
        R.createElement(
          'div', { className: 'exam-side-title', onMouseDown: beginDrag },
          R.createElement('button', { className: 'back', title: '返回功能列表', onClick: function () { setActiveFeature('') } }, '←'),
          R.createElement('span', { className: 'badge' }, feature.ico),
          R.createElement('span', null, feature.label),
          R.createElement('button', { className: 'min', title: '收起', onClick: function () { setActiveFeature(''); setCollapsed(true) } }, '−')
        ),
        R.createElement(ParamPanel, {
          feature: feature.key,
          explain: feature.explain || feature.desc,
          onClose: function () { setActiveFeature('') },
          onSubmit: function (brief) {
            if (props && props.onPick) props.onPick(activeFeature, brief)
          },
        })
      )
    } else {
      var about = showAbout ? renderAbout(R, function () { setShowAbout(false) }) : null
      card = R.createElement(
        'div', { className: 'exam-side-card' + (showAbout ? ' is-about' : ''), style: posStyle },
        R.createElement(
          'div', { className: 'exam-side-title', onMouseDown: beginDrag },
          R.createElement('span', { className: 'badge' }, '✦'),
          R.createElement('span', null, '出题助手'),
          R.createElement('button', {
            className: 'info' + (showAbout ? ' on' : ''),
            title: showAbout ? '收起介绍' : '使用说明 / 设置',
            onClick: function () { setShowAbout(!showAbout) },
          }, 'ⓘ'),
          R.createElement('button', { className: 'min', title: '收起', onClick: function () { setCollapsed(true) } }, '−')
        ),
        about,
        (props && props.features ? props.features : []).map(function (f) {
          var isTip = tipKey === f.key
          return R.createElement(
            'button', {
              key: f.key, className: 'exam-side-btn', title: f.desc,
              onClick: function () {
                if (isTip) { setTipKey(''); setActiveFeature(f.key) }
                else { setTipKey(f.key) }
              },
            },
            R.createElement('span', { className: 'ico', style: { background: f.tint } }, f.ico),
            R.createElement('span', { className: 'lbl' },
              R.createElement('b', null, f.label),
              R.createElement('small', null, f.desc)
            ),
            isTip ? R.createElement('div', { className: 'exam-side-tip' }, f.explain || f.desc) : null
          )
        }),
        R.createElement('div', { className: 'exam-side-foot' }, '点一下看说明 · 再点开参数面板')
      )
    }

    if (ReactDOM && typeof ReactDOM.createPortal === 'function') {
      return ReactDOM.createPortal(card, document.body)
    }
    return card
  }

  var hostCtx = null

  /**
   * standalone 兜底：当 DSH 更新改了 slots 契约（slot 名、register 签名、overlay 焦点）
   * 导致官方 slot 不再渲染时，自己建一个 root 挂到 body，保证 UI 不消失。
   */
  function mountStandalone() {
    if (!CAP.react || !CAP.reactdom) return false
    if (!hostCtx) return false
    try {
      var root = document.getElementById(FALLBACK_MOUNT_ID)
      if (!root) {
        root = document.createElement('div')
        root.id = FALLBACK_MOUNT_ID
        document.body.appendChild(root)
      }
      var R = ReactLib
      var features = FEATURES.map(function (f) {
        return { key: f.key, label: f.label, desc: f.desc, ico: f.ico, tint: f.tint, explain: f.explain }
      })
      var tree = R.createElement(SideCard, {
        features: features,
        onPick: function (key, brief) {
          // standalone 下拿不到 sessionId：尽力从 sessions 服务取当前会话，取不到走输入框兜底。
          var sessions = hostCtx && hostCtx.sessions
          var sid = ''
          try {
            if (sessions && typeof sessions.currentSessionId === 'function') sid = sessions.currentSessionId()
            else if (sessions && typeof sessions.current === 'function') sid = sessions.current()
          } catch (e) {}
          sendPrompt(hostCtx, sid, brief)
        },
      })
      if (typeof ReactDOM.createRoot === 'function') {
        if (!root._egRoot) root._egRoot = ReactDOM.createRoot(root)
        root._egRoot.render(tree)
      } else if (typeof ReactDOM.render === 'function') {
        ReactDOM.render(tree, root)
      } else {
        return false
      }
      CAP.standalone = true
      return true
    } catch (e) {
      CAP.standalone = false
      return false
    }
  }

  /** 健康探针：开启后若官方 slot 没渲染出卡片，启用 standalone。
   *  一旦进入 standalone 就保持到 DSH 重启（slot 契约是启动期决定的，运行期不会自己恢复；
   *  重启会清空页面并重新 apply，那时会重新尝试官方 slot）。这样避免自抖动。 */
  function heal() {
    if (!state.enabled) return
    if (document.getElementById(FALLBACK_MOUNT_ID)) return // 已兜底，别动
    var native = document.querySelector('.exam-side-card, .exam-side-mini')
    if (!native) mountStandalone()
  }

  function registerQuickBar(ctx) {
    hostCtx = ctx
    try {
      CAP.slots = !!(ctx && typeof ctx.inject === 'function')
    } catch (e) { CAP.slots = false }
    ctx.inject(['slots', 'sessions'], function (scope) {
      scope.slots.inject('conversation.input.overlay', function () {
        return scope.slots.register(
          {
            name: 'conversation.input.overlay',
            id: 'exam-gen-quick-bar',
            order: 20,
            inject: function (sessionId) {
              return {
                features: FEATURES.map(function (f) {
                  return { key: f.key, label: f.label, desc: f.desc, ico: f.ico, tint: f.tint, explain: f.explain }
                }),
                onPick: function (key, brief) { sendPrompt(ctx, sessionId, brief) },
              }
            },
          },
          SideCard
        )
      })
    })
  }

  /* ---------------- 启动 ---------------- */

  function apply(ctx) {
    injectStyle()
    watchTheme()

    var tries = 0
    function tick() {
      tries++
      ensureEntry()
      if (tries < 200 && !document.querySelector('[' + ENTRY_ATTR + ']')) {
        state.timer = setTimeout(tick, 500)
      }
    }
    tick()

    try {
      var obs = new MutationObserver(function () {
        if (!document.querySelector('[' + ENTRY_ATTR + ']')) ensureEntry()
      })
      obs.observe(document.body, { childList: true, subtree: true })
    } catch (e) { /* ignore */ }

    readEnabled().then(function (on) {
      state.enabled = !!on
      renderEntry()
      emitState()
    })

    try {
      registerQuickBar(ctx)
    } catch (e) {
      // DSH 更新改了 slot 契约：订阅失败也别让插件白屏，直接上 standalone 兜底。
      try { console.warn('[dsh-exam-gen] slot register failed, using standalone:', e) } catch (e2) {}
      mountStandalone()
    }

    // 周期性自愈：DSH 更新后官方 slot 契约变了 → 自动切 standalone；原生恢复 → 自动撤兜底。
    // 只在插件开启时检查，间隔 3s，开销可忽略。
    if (healTimer) clearInterval(healTimer)
    healTimer = setInterval(heal, 3000)
  }

  /** 尽力加载 React：DSH 更新后可能改了可 require 的模块名或改成全局暴露。 */
  function loadReact(require) {
    // React —— 依次试 require('react')、window.React
    if (!ReactLib) {
      try { ReactLib = require('react') } catch (e) {}
      if (!ReactLib && typeof window !== 'undefined' && window.React) ReactLib = window.React
      if (ReactLib && ReactLib.default && !ReactLib.createElement) ReactLib = ReactLib.default
    }
    // ReactDOM —— require('react-dom')、react-dom/client、window.ReactDOM
    function hasDomApi(o) { return !!(o && (o.render || o.createRoot)) }
    if (!hasDomApi(ReactDOM)) {
      var rd = null
      try { rd = require('react-dom') } catch (e) {}
      if (hasDomApi(rd)) ReactDOM = rd
    }
    if (!hasDomApi(ReactDOM)) {
      var rdc = null
      try { rdc = require('react-dom/client') } catch (e) {}
      if (hasDomApi(rdc)) ReactDOM = rdc
    }
    if (!hasDomApi(ReactDOM) && typeof window !== 'undefined' && window.ReactDOM) ReactDOM = window.ReactDOM
    if (ReactDOM && ReactDOM.default && hasDomApi(ReactDOM.default)) ReactDOM = ReactDOM.default
    CAP.react = !!(ReactLib && ReactLib.createElement && ReactLib.useState && ReactLib.useEffect)
    CAP.reactdom = !!(ReactDOM && (ReactDOM.render || ReactDOM.createRoot))
  }

  function register() {
    var loader = window.__ModuleLoader__
    if (!loader || typeof loader.load !== 'function') return false
    try {
      loader.load({
        id: PLUGIN_ID,
        factory: function (require) {
          try { loadReact(require) } catch (e) { CAP.react = false; CAP.reactdom = false }
          var module = { exports: {} }
          module.exports = { apply: apply, inject: ['sessions'] }
          return module.exports
        },
      })
      return true
    } catch (e) { return false }
  }

  // DSH 更新时加载器可能晚于 client bundle 就绪：等几个 tick 再注册，别一次性失败就放弃。
  var regTries = 0
  function registerWhenReady() {
    if (register()) return
    if (++regTries < 40) setTimeout(registerWhenReady, 250)
  }
  registerWhenReady()
})()
