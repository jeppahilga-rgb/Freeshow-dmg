import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const exe = await fs.readFile('src-tauri/target/release/freeshow-tauri.exe')
const frontend = (await fs.readdir('dist-tauri/assets')).find(name => /^index-.*\.js$/.test(name))
if (!frontend || !exe.includes(Buffer.from(frontend))) throw Error('Release does not embed the current frontend')
const acl = JSON.parse(await fs.readFile('src-tauri/gen/schemas/acl-manifests.json', 'utf8'))
const editor = Object.values(acl).map(v => v.permissions?.['allow-editor-commands']).find(Boolean)
for (const command of ['backup_service', 'import_powerpoint', 'document_pdf', 'dropped_files']) {
    if (!editor?.commands.allow.includes(command)) throw Error('Missing permission: ' + command)
}
const output = path.resolve('../output/FreeShow-Tauri-AuditFixes.exe')
await fs.writeFile(output, exe)
const manifest = { output, bytes: exe.length, frontend, builtAt: new Date().toISOString(), sha256: crypto.createHash('sha256').update(exe).digest('hex') }
await fs.writeFile('../output/FreeShow-Tauri-AuditFixes-build.json', JSON.stringify(manifest, null, 2))
console.log(JSON.stringify(manifest))
