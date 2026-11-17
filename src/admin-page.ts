// 题库管理页（开发者视角）：一个自包含 HTML，无外部依赖、无构建步骤。
//
// 为什么挂在 webServer 上而不是做成聊天卡片：
// 1. 翻题库是「高频、零推理」的操作，走模型每翻一页就是一次 token 往返，不划算；
// 2. 卡片协议限制 ≤120 节点，一页最多十行，看 425 章要翻几十次；
// 3. 这个页面直接在浏览器里跑，读接口、改数据，全程不碰模型。
//
// 页面只用原生 JS：一个 fetch 列表、增删改导入导出，全部落到持久库。
export const ADMIN_PATH = '/exam-bank'
export const ADMIN_API = '/exam-bank/api'
/** 导出的 PDF 从这里下载：/exam-pdf?id=<32位十六进制> */
export const PDF_PATH = '/exam-pdf'

export function adminPageHtml(token: string, enabled = true): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>题库管理 · dsh-exam-gen</title>
<style>
:root{--bg:#0f1115;--panel:#171a21;--line:#262b36;--text:#e6e8ee;--dim:#9aa3b2;--accent:#4f8cff;--ok:#3fb950;--warn:#d29922;--bad:#f85149}
@media (prefers-color-scheme:light){:root{--bg:#f6f7f9;--panel:#fff;--line:#e3e6ec;--text:#1a1d23;--dim:#5b6472;--accent:#2f6fed}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.55 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
header{padding:18px 22px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:14px;flex-wrap:wrap}
h1{font-size:16px;margin:0;font-weight:600}
.pill{font-size:12px;color:var(--dim);border:1px solid var(--line);border-radius:999px;padding:2px 10px}
.stats{display:flex;gap:18px;padding:14px 22px;flex-wrap:wrap;border-bottom:1px solid var(--line)}
.stat{min-width:104px}
.stat b{display:block;font-size:19px;font-variant-numeric:tabular-nums}
.stat span{font-size:12px;color:var(--dim)}
main{padding:16px 22px 60px;max-width:1400px}
.bar{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
input,select,button,textarea{font:inherit;color:inherit;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:7px 11px}
input:focus,select:focus,textarea:focus{outline:2px solid color-mix(in srgb,var(--accent) 45%,transparent);outline-offset:1px}
input[type=search]{min-width:240px;flex:1}
button{cursor:pointer;background:var(--panel)}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}
button.danger{color:var(--bad)}
button.link{color:var(--accent);border-color:transparent;background:transparent;padding:4px 8px}
button:disabled{opacity:.5;cursor:not-allowed}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--dim);font-weight:500;font-size:12px;white-space:nowrap;position:sticky;top:0;background:var(--bg)}
td.q{max-width:520px}
.tag{display:inline-block;font-size:11px;border:1px solid var(--line);border-radius:6px;padding:1px 6px;color:var(--dim);white-space:nowrap}
.tag.src{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 40%,transparent)}
.pager{display:flex;gap:8px;align-items:center;margin-top:14px;color:var(--dim);font-size:13px}
dialog{border:1px solid var(--line);border-radius:14px;background:var(--panel);color:var(--text);padding:0;width:min(760px,94vw)}
dialog::backdrop{background:rgba(0,0,0,.55)}
.dlg-head{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--line)}
.dlg-head h2{font-size:15px;margin:0}
.dlg-body{padding:16px 18px;display:grid;gap:12px}
.row{display:grid;gap:6px}
.row label{font-size:12px;color:var(--dim)}
.row textarea{min-height:76px;resize:vertical}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.dlg-foot{display:flex;justify-content:flex-end;gap:10px;padding:0 18px 16px}
.msg{font-size:12px;padding:8px 10px;border-radius:8px;display:none}
.msg.show{display:block}
.msg.ok{background:color-mix(in srgb,var(--ok) 14%,transparent);color:var(--ok)}
.msg.err{background:color-mix(in srgb,var(--bad) 14%,transparent);color:var(--bad)}
</style>
</head>
<body>
<header>
  <h1>题库管理</h1>
  <span class="pill">dsh-exam-gen</span>
  <span class="pill" id="path-pill">正在读取…</span>
  <span style="flex:1"></span>
  <button id="btn-toggle" class="${enabled ? 'primary' : ''}">${enabled ? '出题：已启用' : '出题：已关闭'}</button>
  <button id="btn-add" class="primary">新增题目</button>
  <button id="btn-export">导出完整库</button>
  <button id="btn-import">导入 JSON</button>
</header>

<div class="stats" id="stats"></div>

<main>
  <div class="bar">
    <input type="search" id="q" placeholder="搜题干 / 章节 / 知识点，例如 一元一次方程、浮力、韦达定理">
    <select id="subject"><option value="">全部学科</option></select>
    <select id="grade"><option value="">全部年级</option><option>初一</option><option>初二</option><option>初三</option><option>高一</option><option>高二</option><option>高三</option></select>
    <select id="chapter"><option value="">全部章节</option></select>
    <select id="type"><option value="">全部题型</option><option value="choice">选择</option><option value="fill">填空</option><option value="solve">解答</option><option value="solution">解答(solution)</option></select>
    <select id="difficulty"><option value="">全部难度</option><option>基础</option><option>中档</option><option>拔高</option></select>
    <button id="btn-search" class="primary">查询</button>
  </div>
  <div class="msg" id="msg"></div>
  <table>
    <thead><tr><th>#</th><th>章节</th><th>年级</th><th>学科</th><th>难度</th><th>题型</th><th>题干</th><th>答案</th><th>操作</th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
  <div class="pager">
    <button id="prev">上一页</button>
    <span id="pageinfo">–</span>
    <button id="next">下一页</button>
    <span style="flex:1"></span>
    <span>每页 <select id="size"><option>20</option><option selected>50</option><option>100</option></select> 条</span>
  </div>
</main>

<dialog id="dlg-add">
  <form method="dialog" id="form-add">
    <div class="dlg-head"><h2>新增题目</h2><button value="cancel" formnovalidate>关闭</button></div>
    <div class="dlg-body">
      <div class="grid2">
        <div class="row"><label>年级</label>
          <select name="grade"><option>初一</option><option>初二</option><option>初三</option><option>高一</option><option>高二</option><option>高三</option></select></div>
        <div class="row"><label>学科</label>
          <select name="subject"><option>数学</option><option>物理</option><option>化学</option></select></div>
        <div class="row"><label>章节（可留空）</label><input name="chapter" placeholder="例如 七上 第五章 一元一次方程"></div>
        <div class="row"><label>知识点（可留空）</label><input name="topic" placeholder="例如 移项与合并同类项"></div>
        <div class="row"><label>难度</label>
          <select name="difficulty"><option>基础</option><option selected>中档</option><option>拔高</option></select></div>
        <div class="row"><label>题型</label>
          <select name="type" id="f-type"><option value="choice" selected>选择</option><option value="fill">填空</option><option value="solve">解答</option></select></div>
      </div>
      <div class="row"><label>题干</label><textarea name="content" required placeholder="只写题干本身，不要写答案"></textarea></div>
      <div class="row" id="row-options"><label>选项（每行一个，选择题材必填）</label><textarea name="options" placeholder="4&#10;6&#10;8&#10;10"></textarea></div>
      <div class="grid2">
        <div class="row"><label>答案（选择题填字母 A/B/C/D）</label><input name="answer" required></div>
        <div class="row"><label>答案原文（可留空，自动从选项取）</label><input name="answerText"></div>
      </div>
      <div class="row"><label>解析（可留空）</label><textarea name="explanation"></textarea></div>
      <div class="msg" id="add-msg"></div>
    </div>
    <div class="dlg-foot">
      <button value="cancel" formnovalidate>取消</button>
      <button value="save" class="primary" id="btn-save">保存并入库</button>
    </div>
  </form>
</dialog>

<dialog id="dlg-edit">
  <form method="dialog" id="form-edit">
    <div class="dlg-head"><h2>编辑题目</h2><button value="cancel" formnovalidate>关闭</button></div>
    <div class="dlg-body">
      <input type="hidden" name="id">
      <div class="grid2">
        <div class="row"><label>年级</label>
          <select name="grade"><option value="">(不变)</option><option>初一</option><option>初二</option><option>初三</option><option>高一</option><option>高二</option><option>高三</option></select></div>
        <div class="row"><label>学科</label>
          <select name="subject"><option value="">(不变)</option><option>数学</option><option>物理</option><option>化学</option></select></div>
        <div class="row"><label>章节</label><input name="chapter" placeholder="留空表示不修改"></div>
        <div class="row"><label>知识点</label><input name="topic" placeholder="留空表示不修改"></div>
        <div class="row"><label>难度</label>
          <select name="difficulty"><option value="">(不变)</option><option>基础</option><option>中档</option><option>拔高</option></select></div>
        <div class="row"><label>题型</label>
          <select name="type" id="fe-type"><option value="">(不变)</option><option value="choice">选择</option><option value="fill">填空</option><option value="solve">解答</option></select></div>
      </div>
      <div class="row"><label>题干</label><textarea name="content" placeholder="留空表示不修改"></textarea></div>
      <div class="row" id="fe-options"><label>选项（每行一个；留空表示不修改）</label><textarea name="options" placeholder="4&#10;6&#10;8&#10;10"></textarea></div>
      <div class="grid2">
        <div class="row"><label>答案</label><input name="answer"></div>
        <div class="row"><label>答案原文</label><input name="answerText"></div>
      </div>
      <div class="row"><label>解析</label><textarea name="explanation"></textarea></div>
      <div class="msg" id="edit-msg"></div>
    </div>
    <div class="dlg-foot">
      <button value="cancel" formnovalidate>取消</button>
      <button value="save" class="primary" id="btn-edit-save">保存修改</button>
    </div>
  </form>
</dialog>

<dialog id="dlg-import">
  <form method="dialog" id="form-import">
    <div class="dlg-head"><h2>导入题目 JSON</h2><button value="cancel" formnovalidate>关闭</button></div>
    <div class="dlg-body">
      <div class="row"><label>粘贴 JSON 数组（字段同导出格式，最多 500 条）</label>
        <textarea name="payload" style="min-height:220px;font-family:ui-monospace,Consolas,monospace;font-size:12px" placeholder='[{"grade":"初一","subject":"数学","content":"…","type":"fill","answer":"7"}]'></textarea></div>
      <div class="msg" id="import-msg"></div>
    </div>
    <div class="dlg-foot">
      <button value="cancel" formnovalidate>取消</button>
      <button value="save" class="primary" id="btn-import-save">导入</button>
    </div>
  </form>
</dialog>

<script>
const TOKEN = ${JSON.stringify(token)};
const state = { page: 1, size: 50, total: 0, keyword: '', subject: '', grade: '', chapter: '', type: '', difficulty: '' };
const $ = (id) => document.getElementById(id);
const rows = $('rows');
const _chapters = new Set();

function esc(s){ return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function flash(el, text, ok){ el.textContent = text; el.className = 'msg show ' + (ok ? 'ok' : 'err'); setTimeout(() => { el.className = 'msg'; }, 6000); }

async function api(path, options){
  const res = await fetch(path, Object.assign({ headers: { 'content-type': 'application/json', 'x-exam-token': TOKEN } }, options || {}));
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

async function loadStats(){
  const d = await api('/exam-bank/api/stats');
  $('path-pill').textContent = d.path || '';
  const s = d.summary || {};
  const subj = Object.entries(s.subjects || {}).map(([k,v]) => k + ' ' + v).join(' · ');
  $('stats').innerHTML = [
    ['总题数', s.total ?? d.size ?? 0],
    ['章节', s.chapters ?? 0],
    ['初中', s.junior ?? 0],
    ['高中', s.senior ?? 0],
  ].map(([k,v]) => '<div class="stat"><b>' + v + '</b><span>' + k + '</span></div>').join('')
   + '<div class="stat" style="flex:1"><b style="font-size:13px;font-weight:400;color:var(--dim)">' + esc(subj) + '</b><span>学科分布</span></div>';
  const sel = $('subject');
  if (sel.options.length <= 1) {
    for (const name of Object.keys(s.subjects || {})) sel.add(new Option(name, name));
  }
  // 章节下拉：从统计里没有完整章节列表，用当前列表项补全
  const chSel = $('chapter');
  const cur = chSel.value;
  if (_chapters.size) {
    chSel.innerHTML = '<option value="">全部章节</option>' + [..._chapters].sort().map((c) => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
    chSel.value = cur;
  }
}

const TYPE_NAME = { choice: '选择', fill: '填空', solve: '解答', solution: '解答', short: '解答', self: '解答' };

async function loadList(){
  const p = new URLSearchParams({
    limit: String(state.size), offset: String((state.page - 1) * state.size),
    keyword: state.keyword, subject: state.subject, grade: state.grade,
    chapter: state.chapter, type: state.type, difficulty: state.difficulty,
  });
  const d = await api('/exam-bank/api/items?' + p.toString());
  state.total = d.total || 0;
  rows.innerHTML = (d.items || []).map((it, i) => {
    const no = (state.page - 1) * state.size + i + 1;
    const src = it.source === 'custom' ? ' <span class="tag src">手工</span>' : it.source === 'generated' ? ' <span class="tag src">生成</span>' : '';
    const ops = '<button class="link" data-edit="' + esc(it.id) + '">改</button>'
      + '<button class="danger" data-del="' + esc(it.id) + '">删</button>';
    return '<tr><td>' + no + '</td><td><span class="tag">' + esc(it.chapter || '—') + '</span></td><td>' + esc(it.grade || '') + '</td><td>' + esc(it.subject || '') + '</td><td>' + esc(it.difficulty || '') + '</td><td>' + esc(TYPE_NAME[it.type] || it.type || '') + '</td>'
      + '<td class="q">' + esc((it.content || '').slice(0, 160)) + (it.content && it.content.length > 160 ? '…' : '') + src + '</td>'
      + '<td>' + esc((it.answerText || it.answer || '').toString().slice(0, 24)) + '</td><td>' + ops + '</td></tr>';
  }).join('') || '<tr><td colspan="9" style="color:var(--dim);padding:20px">没有匹配的题</td></tr>';
  const pages = Math.max(1, Math.ceil(state.total / state.size));
  $('pageinfo').textContent = '第 ' + state.page + ' / ' + pages + ' 页 · 共 ' + state.total + ' 条';
  $('prev').disabled = state.page <= 1;
  $('next').disabled = state.page >= pages;
  // 收集章节候选
  for (const it of (d.items || [])) if (it.chapter) _chapters.add(it.chapter);
}

async function refresh(){ try { await loadStats(); await loadList(); } catch (e) { flash($('msg'), e.message, false); } }

$('btn-search').onclick = () => { state.keyword = $('q').value.trim(); state.subject = $('subject').value; state.grade = $('grade').value; state.chapter = $('chapter').value; state.type = $('type').value; state.difficulty = $('difficulty').value; state.page = 1; loadList().catch((e) => flash($('msg'), e.message, false)); };
$('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-search').click(); });
$('prev').onclick = () => { if (state.page > 1) { state.page -= 1; loadList().catch((e) => flash($('msg'), e.message, false)); } };
$('next').onclick = () => { state.page += 1; loadList().catch((e) => flash($('msg'), e.message, false)); };
$('size').onchange = () => { state.size = Number($('size').value); state.page = 1; loadList().catch((e) => flash($('msg'), e.message, false)); };

function itemById(id){
  const tr = [...rows.children].find((r) => r.querySelector('[data-edit="' + id + '"]') || r.querySelector('[data-del="' + id + '"]'));
  return tr ? { tr } : null;
}

async function openEdit(id){
  // 从当前列表的题干里取不到完整字段，直接重新拉一遍目标页第一行之外的不可行；
  // 这里用一个轻量 fetch：带 keyword 过滤到单条不可靠，所以按当前列表缓存恢复。
  // 为了简单，编辑弹窗预填只做「题干/答案」，其余留空表示不修改。
  const tr = itemById(id);
  const cells = tr ? tr.tr.children : null;
  const content = cells ? cells[6].textContent.replace(/\s*手工\s*|\s*生成\s*$/, '') : '';
  const answer = cells ? cells[7].textContent : '';
  $('form-edit').reset();
  $('form-edit').querySelector('[name=id]').value = id;
  $('form-edit').querySelector('[name=content]').value = content;
  $('form-edit').querySelector('[name=answer]').value = answer;
  $('edit-msg').className = 'msg';
  $('dlg-edit').showModal();
}

rows.addEventListener('click', async (e) => {
  const del = e.target?.dataset?.del;
  const edit = e.target?.dataset?.edit;
  if (del) {
    if (!confirm('确认删除这道题？')) return;
    try { await api('/exam-bank/api/delete', { method: 'POST', body: JSON.stringify({ id: del }) }); flash($('msg'), '已删除', true); refresh(); }
    catch (err) { flash($('msg'), err.message, false); }
  } else if (edit) {
    openEdit(edit);
  }
});

$('btn-add').onclick = () => { $('add-msg').className = 'msg'; $('dlg-add').showModal(); };

// 插件总开关：点了立刻生效，下次说「出套卷子」时插件就不接话了
$('btn-toggle').onclick = async () => {
  const btn = $('btn-toggle');
  const on = /已启用/.test(btn.textContent);
  try {
    const d = await api('/exam-bank/api/toggle', { method: 'POST', body: JSON.stringify({ enabled: !on }) });
    btn.textContent = d.enabled ? '出题：已启用' : '出题：已关闭';
    btn.className = d.enabled ? 'primary' : '';
    flash($('msg'), d.enabled ? '插件已启用：现在说「出套卷子」就会出。' : '插件已关闭：出题工具不再响应，普通对话不受影响。', true);
  } catch (e) {
    flash($('msg'), e.message, false);
  }
};
$('f-type').onchange = () => { $('row-options').style.display = $('f-type').value === 'choice' ? '' : 'none'; };
$('fe-type').onchange = () => { $('fe-options').style.display = $('fe-type').value === 'choice' ? '' : 'none'; };
$('form-add').addEventListener('submit', async (e) => {
  if (e.submitter && e.submitter.value === 'cancel') return;
  e.preventDefault();
  const f = new FormData($('form-add'));
  const body = {
    grade: f.get('grade'), subject: f.get('subject'), chapter: f.get('chapter'), topic: f.get('topic'),
    difficulty: f.get('difficulty'), type: f.get('type'), content: f.get('content'),
    options: String(f.get('options') || '').split('\\n').map((s) => s.trim()).filter(Boolean),
    answer: f.get('answer'), answerText: f.get('answerText'), explanation: f.get('explanation'),
  };
  try {
    const d = await api('/exam-bank/api/add', { method: 'POST', body: JSON.stringify(body) });
    if (d.skipped) flash($('add-msg'), '已存在相同题干，跳过（当前共 ' + d.size + ' 题）', false);
    else flash($('add-msg'), '已入库（当前共 ' + d.size + ' 题）', true);
    $('form-add').reset();
    refresh();
    if (!d.skipped) setTimeout(() => $('dlg-add').close(), 700);
  } catch (err) { flash($('add-msg'), err.message, false); }
});

$('form-edit').addEventListener('submit', async (e) => {
  if (e.submitter && e.submitter.value === 'cancel') return;
  e.preventDefault();
  const f = new FormData($('form-edit'));
  const id = String(f.get('id') || '');
  const raw = {
    id,
    grade: f.get('grade'), subject: f.get('subject'), chapter: f.get('chapter'), topic: f.get('topic'),
    difficulty: f.get('difficulty'), type: f.get('type'), content: f.get('content'),
    answer: f.get('answer'), answerText: f.get('answerText'), explanation: f.get('explanation'),
  };
  const optionsText = String(f.get('options') || '').trim();
  // 只发送有值的字段，空字段表示「不修改」
  const body = { id };
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'id') continue;
    if (v !== '' && v !== null && v !== undefined) body[k] = v;
  }
  if (optionsText) body.options = optionsText.split('\\n').map((s) => s.trim()).filter(Boolean);
  try {
    const d = await api('/exam-bank/api/update', { method: 'POST', body: JSON.stringify(body) });
    flash($('edit-msg'), '已保存（当前共 ' + d.size + ' 题）', true);
    refresh();
    setTimeout(() => $('dlg-edit').close(), 700);
  } catch (err) { flash($('edit-msg'), err.message, false); }
});

$('btn-export').onclick = () => {
  window.open('/exam-bank/api/export?token=' + encodeURIComponent(TOKEN), '_blank');
};

$('btn-import').onclick = () => { $('import-msg').className = 'msg'; $('dlg-import').showModal(); };
$('form-import').addEventListener('submit', async (e) => {
  if (e.submitter && e.submitter.value === 'cancel') return;
  e.preventDefault();
  let items;
  try { items = JSON.parse(String(new FormData($('form-import')).get('payload') || '[]')); }
  catch { flash($('import-msg'), 'JSON 解析失败', false); return; }
  try {
    const d = await api('/exam-bank/api/import', { method: 'POST', body: JSON.stringify({ items }) });
    flash($('import-msg'), '导入完成：新增 ' + d.added + '，跳过 ' + d.skipped + '（当前共 ' + d.size + ' 题）', true);
    refresh();
    setTimeout(() => $('dlg-import').close(), 900);
  } catch (err) { flash($('import-msg'), err.message, false); }
});

refresh();
</script>
</body>
</html>`
}
