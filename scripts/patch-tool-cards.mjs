#!/usr/bin/env node
/**
 * 安装后修正 dsh-tool-cards 的两处激活顺序缺陷。
 *
 * 背景：dsh-tool-cards@0.2.2（当前 npm 最新）用
 *   ctx.effect(() => { const webServer = ctx.get('webServer'); if (!webServer) return () => {} })
 * 注册 /chat-ui/action 与 /chat-ui/state 两条路由。effect 只执行一次，而 ctx.get 不建立依赖，
 * 因此当 webServer / connection 比该插件晚激活时，两条路由永远不会注册 ——
 * 卡片能渲染、能点，但提交一律 405，输入状态也不保存。
 *
 * 本脚本只在安装后跑一次：
 *   - 已经打过补丁 → 跳过（幂等）
 *   - 版本不是已验证的版本 → 什么都不改，只打印提示（不冒险改未知代码）
 *   - 找不到该包 → 静默跳过（用户可能没装卡片插件）
 *   - 文本对不上（上游改过）→ 一处都不写，避免装出一个半坏的包
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MARK = '[dsh-exam-gen patch]'
const VERIFIED_VERSIONS = new Set(['0.2.2'])

/** 从本包位置向上找 dsh-tool-cards（pnpm / npm 的 hoisting 都可能，逐层找）。 */
function locate() {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(dir, 'node_modules', 'dsh-tool-cards')
    if (existsSync(join(candidate, 'host.js'))) return candidate
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

/** 行尾由文件决定：npm 包里是 CRLF，本地编辑过的是 LF，两种都要能命中。 */
function buildEdits(eol) {
  const block = (lines) => lines.join(eol)
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
  ]
}

function main() {
  const dir = locate()
  if (dir === undefined) {
    console.log('[dsh-exam-gen] dsh-tool-cards 未安装，跳过补丁。')
    return
  }

  const hostPath = join(dir, 'host.js')
  const source = readFileSync(hostPath, 'utf8')

  if (source.includes(MARK)) {
    console.log('[dsh-exam-gen] dsh-tool-cards 已打过补丁，跳过。')
    return
  }

  const version = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version
  if (!VERIFIED_VERSIONS.has(version)) {
    console.warn(
      `[dsh-exam-gen] dsh-tool-cards@${version} 不在已验证版本（${[...VERIFIED_VERSIONS].join(', ')}）内，` +
        '不做修改。若卡片提交报 405，请把版本号报给我们更新补丁。',
    )
    return
  }

  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  let next = source
  const failed = []
  for (const edit of buildEdits(eol)) {
    if (!next.includes(edit.from)) {
      failed.push(edit.label)
      continue
    }
    next = next.replace(edit.from, edit.to)
  }

  if (failed.length > 0) {
    console.warn(
      `[dsh-exam-gen] 补丁未完全生效（未匹配：${failed.join('、')}）。` +
        '上游源码可能已变动，本次未写入任何改动，以免装出半坏的包。',
    )
    return
  }

  writeFileSync(hostPath, next, 'utf8')
  console.log('[dsh-exam-gen] 已修正 dsh-tool-cards 的卡片提交路由（405 → 正常）。')
}

main()
