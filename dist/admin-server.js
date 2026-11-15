// 题库管理页的服务端：往 DSH 自己的 webServer 上挂 4 条路由。
//
// 借鉴 dsh-tool-cards 的接线方式（它是同一套 API 的现成例子）：
//   ctx.inject(['webServer','connection'], () => webServer.register({ kind:'exact', path, handler }))
// 这里必须用 ctx.inject 而不是 ctx.effect：webServer 服务晚于本插件激活时，
// ctx.effect 里的 ctx.get('webServer') 会拿到 undefined，路由就永久丢了（dsh-tool-cards 0.2.2 踩过这个坑）。
import { randomBytes } from 'node:crypto';
import { ADMIN_API, ADMIN_PATH, adminPageHtml, PDF_PATH } from './admin-page.js';
import { appendItem, importItems, readBankFile, recomputeSummary, removeItem, toExportJson, bankPath } from './bank-store.js';
import { loadBank } from './bank.js';
import { getPdf } from './pdf-store.js';
const MAX_BODY_BYTES = 4 * 1024 * 1024;
/** webServer 起来后把监听地址记下来，工具返回的下载链接要用绝对 URL。 */
let adminOrigin = '';
export function currentOrigin() {
    return adminOrigin;
}
function resolveOrigin(webServer) {
    const target = webServer;
    if (!target)
        return '';
    const direct = target.origin ?? target.url ?? target.baseUrl;
    if (typeof direct === 'string' && /^https?:\/\//.test(direct))
        return direct.replace(/\/$/, '');
    const server = target.server;
    const address = typeof server?.address === 'function' ? server.address() : undefined;
    if (address && typeof address === 'object' && 'port' in address) {
        const port = address.port;
        if (port)
            return `http://127.0.0.1:${port}`;
    }
    const port = Number(target.port ?? 0);
    if (port)
        return `http://127.0.0.1:${port}`;
    return '';
}
async function readJsonBody(req) {
    const chunks = [];
    let size = 0;
    const iterator = req[Symbol.asyncIterator]?.();
    if (!iterator)
        return {};
    for (;;) {
        const step = await iterator.next();
        if (step.done)
            break;
        const chunk = Buffer.isBuffer(step.value) ? step.value : Buffer.from(String(step.value));
        size += chunk.length;
        if (size > MAX_BODY_BYTES)
            throw new Error('请求体过大');
        chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8').trim();
    if (!text)
        return {};
    return JSON.parse(text);
}
function sendJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(payload),
        'cache-control': 'no-store',
    });
    res.end(payload);
}
function sendHtml(res, status, html) {
    res.writeHead(status, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(html),
        'cache-control': 'no-store',
    });
    res.end(html);
}
function sendText(res, status, text, filename) {
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(text),
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
    });
    res.end(text);
}
function sendBinary(res, status, buffer, filename) {
    res.writeHead(status, {
        'content-type': 'application/pdf',
        'content-length': buffer.length,
        'content-disposition': `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'cache-control': 'no-store',
    });
    res.end(buffer);
}
function queryOf(req) {
    const raw = req.url ?? '/';
    const index = raw.indexOf('?');
    return new URLSearchParams(index >= 0 ? raw.slice(index + 1) : '');
}
/** 内存过滤：题库 3340 条全表扫一遍不到 1 ms，不必建索引。 */
export function filterItems(items, params) {
    const q = (params.get('q') ?? '').trim().toLowerCase();
    const subject = params.get('subject') ?? '';
    const difficulty = params.get('difficulty') ?? '';
    const source = params.get('source') ?? '';
    const chapter = params.get('chapter') ?? '';
    return items.filter((item) => {
        if (subject && item.subject !== subject)
            return false;
        if (difficulty && item.difficulty !== difficulty)
            return false;
        if (source && item.source !== source)
            return false;
        if (chapter && !(item.chapter ?? '').includes(chapter))
            return false;
        if (!q)
            return true;
        const haystack = `${item.content ?? ''} ${item.chapter ?? ''} ${item.topic ?? ''} ${item.answerText ?? ''}`.toLowerCase();
        return haystack.includes(q);
    });
}
/**
 * 注册题库管理页。返回页面地址（未启用时返回 undefined），方便在日志里打印给开发者。
 */
export function registerAdminPage(ctx, deps) {
    if (!deps.enabled)
        return undefined;
    const token = randomBytes(16).toString('hex');
    const apiBase = ADMIN_API;
    ctx.inject(['webServer', 'connection'], () => {
        const webServer = ctx.get('webServer');
        if (!webServer) {
            ctx.logger?.('dsh-exam-gen')?.warn?.('webServer 不可用，题库管理页未挂载');
            return;
        }
        const connection = ctx.get('connection');
        const hasGuard = typeof connection?.requestRejection === 'function';
        adminOrigin = resolveOrigin(webServer);
        console.log(`[dsh-exam-gen] webServer keys=${Object.keys(webServer).join(',')} origin=${adminOrigin || '(unknown)'}`);
        const sameOrigin = (req) => !hasGuard || connection?.requestRejection?.(req) === undefined;
        const tokenOk = (req) => {
            const header = req.headers?.['x-exam-token'];
            const fromHeader = Array.isArray(header) ? header[0] : header;
            if (fromHeader === token)
                return true;
            return queryOf(req).get('token') === token;
        };
        const pageRoute = webServer.register({
            kind: 'exact',
            path: ADMIN_PATH,
            handler: async (req, res) => {
                if (!sameOrigin(req))
                    return sendJson(res, 403, { ok: false, error: 'forbidden' });
                return sendHtml(res, 200, adminPageHtml(token));
            },
        });
        const statsRoute = webServer.register({
            kind: 'exact',
            path: `${apiBase}/stats`,
            handler: async (req, res) => {
                if (!sameOrigin(req) || !tokenOk(req))
                    return sendJson(res, 403, { ok: false, error: 'forbidden' });
                const file = bankPath(deps.dir);
                const bank = await readBankFile(file);
                const index = await loadBank(deps.dir);
                return sendJson(res, 200, {
                    ok: true,
                    path: file,
                    size: bank.items.length,
                    summary: recomputeSummary(bank.items),
                    license: bank.license,
                    chapters: index.chapters.size,
                });
            },
        });
        const itemsRoute = webServer.register({
            kind: 'exact',
            path: `${apiBase}/items`,
            handler: async (req, res) => {
                if (!sameOrigin(req) || !tokenOk(req))
                    return sendJson(res, 403, { ok: false, error: 'forbidden' });
                const params = queryOf(req);
                const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
                const size = Math.min(200, Math.max(1, Number(params.get('size') ?? 50) || 50));
                const bank = await readBankFile(bankPath(deps.dir));
                const matched = filterItems(bank.items, params);
                const start = (page - 1) * size;
                return sendJson(res, 200, {
                    ok: true,
                    total: matched.length,
                    page,
                    size,
                    items: matched.slice(start, start + size),
                });
            },
        });
        const addRoute = webServer.register({
            kind: 'exact',
            path: `${apiBase}/add`,
            handler: async (req, res) => {
                if (!sameOrigin(req) || !tokenOk(req))
                    return sendJson(res, 403, { ok: false, error: 'forbidden' });
                if (req.method !== 'POST')
                    return sendJson(res, 405, { ok: false, error: '需要 POST' });
                let body;
                try {
                    body = await readJsonBody(req);
                }
                catch (error) {
                    return sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : '请求体无法解析' });
                }
                const draft = (body ?? {});
                const result = await appendItem(deps.dir, { ...draft, source: draft.source ?? 'custom' });
                if (!result.ok)
                    return sendJson(res, 400, { ok: false, error: result.errors.join('；'), errors: result.errors });
                return sendJson(res, 200, { ok: true, id: result.id, size: result.size });
            },
        });
        const deleteRoute = webServer.register({
            kind: 'exact',
            path: `${apiBase}/delete`,
            handler: async (req, res) => {
                if (!sameOrigin(req) || !tokenOk(req))
                    return sendJson(res, 403, { ok: false, error: 'forbidden' });
                if (req.method !== 'POST')
                    return sendJson(res, 405, { ok: false, error: '需要 POST' });
                const body = (await readJsonBody(req).catch(() => ({})));
                if (!body?.id)
                    return sendJson(res, 400, { ok: false, error: '缺少 id' });
                const result = await removeItem(deps.dir, body.id);
                if (!result.ok)
                    return sendJson(res, 400, { ok: false, error: result.errors.join('；') });
                return sendJson(res, 200, { ok: true, size: result.size });
            },
        });
        const importRoute = webServer.register({
            kind: 'exact',
            path: `${apiBase}/import`,
            handler: async (req, res) => {
                if (!sameOrigin(req) || !tokenOk(req))
                    return sendJson(res, 403, { ok: false, error: 'forbidden' });
                if (req.method !== 'POST')
                    return sendJson(res, 405, { ok: false, error: '需要 POST' });
                let body;
                try {
                    body = await readJsonBody(req);
                }
                catch (error) {
                    return sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : '请求体无法解析' });
                }
                const items = body?.items;
                if (!Array.isArray(items))
                    return sendJson(res, 400, { ok: false, error: 'items 必须是数组' });
                const result = await importItems(deps.dir, items.map((item) => ({ ...item, source: item.source ?? 'custom' })));
                if (!result.ok)
                    return sendJson(res, 400, { ok: false, error: result.errors.join('；'), errors: result.errors });
                return sendJson(res, 200, { ok: true, size: result.size, evicted: result.evicted ?? 0 });
            },
        });
        const exportRoute = webServer.register({
            kind: 'exact',
            path: `${apiBase}/export`,
            handler: async (req, res) => {
                if (!sameOrigin(req) || !tokenOk(req))
                    return sendJson(res, 403, { ok: false, error: 'forbidden' });
                const bank = await readBankFile(bankPath(deps.dir));
                const matched = filterItems(bank.items, queryOf(req));
                const stamp = new Date().toISOString().slice(0, 10);
                return sendText(res, 200, toExportJson(matched), `exam-bank-${stamp}.json`);
            },
        });
        // PDF 下载：卷子只在内存里活 10 分钟，这里按 id 取，不读盘也不列目录
        const pdfRoute = webServer.register({
            kind: 'exact',
            path: PDF_PATH,
            handler: (req, res) => {
                const id = queryOf(req).get('id') ?? '';
                const hit = /^[a-f0-9]{32}$/.test(id) ? getPdf(id) : undefined;
                if (!hit)
                    return sendJson(res, 404, { ok: false, error: '文件已过期，请重新导出' });
                return sendBinary(res, 200, hit.buffer, hit.fileName);
            },
        });
        ctx.logger?.('dsh-exam-gen')?.info?.(`题库管理页：${ADMIN_PATH}`);
        return [pageRoute, statsRoute, itemsRoute, addRoute, deleteRoute, importRoute, exportRoute, pdfRoute];
    });
    return ADMIN_PATH;
}
