/**
 * 启动时修正 dsh-tool-cards 的两处激活顺序缺陷（不需要 postinstall）。
 *
 * 为什么不放 postinstall：pnpm 10 默认不执行依赖的构建脚本，遇到 postinstall 会直接
 * 抛 `ERR_PNPM_IGNORED_BUILDS` 让 `dsh plugin add` 失败。陌生人装插件时不该先学
 * `pnpm approve-builds`。改成运行时自检：装的时候什么脚本都不跑，启动时发现没打补丁
 * 就自己补上，补完打印一行。
 *
 * 安全性：
 *   - 只改 dsh-tool-cards@0.2.2（已验证的版本），其它版本只提示不动手
 *   - 文本对不上（上游改过）→ 一处都不写，避免改出半坏的包
 *   - 已含 MARK → 跳过（幂等）
 *   - 找不到包 / 无写权限 → 返回原因，插件照常工作（只是卡片提交会 405）
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const MARK = '[dsh-exam-gen patch]';
const VERIFIED_VERSIONS = new Set(['0.2.2']);
/** 行尾由文件决定：npm 包里是 CRLF，本地编辑过的是 LF，两种都要能命中。 */
function buildEdits(eol) {
    const block = (lines) => lines.join(eol);
    return [
        {
            label: 'action route',
            from: block([
                '  ctx.effect(() => {',
                "    const webServer = ctx.get('webServer');",
                '    if (!webServer) {',
                "      ctx.logger?.('dsh-tool-cards')?.warn?.('webServer unavailable; card actions stay local');",
                '      return () => {};',
            ]),
            to: block([
                `  // ${MARK} effect → inject：服务晚激活时路由会永久丢失。`,
                "  ctx.inject(['webServer', 'connection'], () => {",
                "    const webServer = ctx.get('webServer');",
                '    if (!webServer) {',
                "      ctx.logger?.('dsh-tool-cards')?.warn?.('webServer unavailable; card actions stay local');",
                '      return;',
            ]),
        },
        {
            label: 'action route label',
            from: "  }, 'dsh-tool-cards: card action route');",
            to: '  });',
        },
        {
            label: 'state route',
            from: block([
                '  ctx.effect(() => {',
                "    const webServer = ctx.get('webServer');",
                '    if (!webServer) return () => {};',
            ]),
            to: block([
                `  // ${MARK} effect → inject：与 action 路由同一处缺陷。`,
                "  ctx.inject(['webServer', 'connection'], () => {",
                "    const webServer = ctx.get('webServer');",
                '    if (!webServer) return;',
            ]),
        },
        {
            label: 'state route label',
            from: "  }, 'dsh-tool-cards: card state route');",
            to: '  });',
        },
    ];
}
function locate(probe) {
    let base;
    try {
        base = dirname(probe('dsh-tool-cards'));
    }
    catch {
        return undefined;
    }
    // 兼容布局：包根目录（index.js 同级）或 lib/ 子目录（向上找一层）
    for (const candidate of [base, dirname(base)]) {
        if (existsSync(join(candidate, 'host.js')))
            return candidate;
    }
    return undefined;
}
/** 幂等：安装后可反复调用。返回状态供日志使用。 */
export function ensureCardPatch() {
    const require = createRequire(import.meta.url);
    const dir = locate((id) => require.resolve(id));
    if (dir === undefined)
        return { outcome: 'no-tool-cards', detail: '未安装 dsh-tool-cards' };
    const hostPath = join(dir, 'host.js');
    let source;
    try {
        source = readFileSync(hostPath, 'utf8');
    }
    catch (error) {
        return { outcome: 'write-failed', detail: `读不到 host.js：${error.message}` };
    }
    if (source.includes(MARK))
        return { outcome: 'already', detail: `已打过补丁（${hostPath}）` };
    let version = 'unknown';
    try {
        version = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version ?? 'unknown';
    }
    catch {
        /* 拿不到版本就按未验证处理 */
    }
    if (!VERIFIED_VERSIONS.has(version)) {
        return {
            outcome: 'version-untouched',
            detail: `dsh-tool-cards@${version} 不在已验证版本（${[...VERIFIED_VERSIONS].join(', ')}）内，未改动`,
        };
    }
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    let next = source;
    const missed = [];
    for (const edit of buildEdits(eol)) {
        if (!next.includes(edit.from)) {
            missed.push(edit.label);
            continue;
        }
        next = next.replace(edit.from, edit.to);
    }
    if (missed.length > 0) {
        return { outcome: 'pattern-miss', detail: `未匹配：${missed.join('、')}（未写入任何改动）` };
    }
    try {
        writeFileSync(hostPath, next, 'utf8');
    }
    catch (error) {
        return { outcome: 'write-failed', detail: `写入失败：${error.message}` };
    }
    return { outcome: 'patched', detail: `已修正卡片提交路由（${hostPath}）` };
}
