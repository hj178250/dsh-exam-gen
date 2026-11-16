import { readFileSync, writeFileSync } from 'node:fs'

const p = './package.json'
const raw = readFileSync(p, 'utf8').replace(/^\uFEFF/, '')
const j = JSON.parse(raw)

j.scripts = j.scripts || {}
j.scripts['sync:client'] = 'node scripts/sync-client.mjs'
j.scripts.build = 'tsc -p tsconfig.json && npm run sync:client'

j.files = ['dist', 'data', 'scripts', 'cordis.patch.yml', 'README.md']
j.dsh = j.dsh || {}
j.dsh.bundle = j.dsh.bundle || { patch: './cordis.patch.yml' }
j.dsh.client = { platform: 'web', inject: [] }
j.exports = j.exports || {}
j.exports['./client'] = { default: './dist/client.js' }

writeFileSync(p, JSON.stringify(j, null, 2) + '\n', 'utf8')
console.log('[exam-gen] package.json updated')
console.log('  dsh.client =', JSON.stringify(j.dsh.client))
console.log('  exports    =', Object.keys(j.exports).join(', '))
console.log('  build      =', j.scripts.build)
