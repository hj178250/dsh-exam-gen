import { copyFileSync, mkdirSync } from 'node:fs'

mkdirSync('src', { recursive: true })
mkdirSync('dist', { recursive: true })
// src/client.js 是唯一权威源：只做 src → dist 单向同步。
// 旧版第一行用 dist 覆盖 src，会把手写的 UI 改动冲掉，已移除。
copyFileSync('src/client.js', 'dist/client.js')
console.log('[exam-gen] client.js synced (src → dist)')
