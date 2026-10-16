import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const exe = await fs.readFile('src-tauri/target/release/freeshow-tauri.exe')
const main = (await fs.readdir('dist-tauri/assets')).find(name => /^index-.*\.js$/.test(name))
if (!main || !exe.includes(Buffer.from(main))) throw Error('Release does not embed the current frontend')
const acl = JSON.parse(await fs.readFile('src-tauri/gen/schemas/acl-manifests.json', 'utf8'))
const editor = Object.values(acl).map(value => value.permissions?.['allow-editor-commands']).find(Boolean)
for (const command of ['import_powerpoint', 'library_service', 'export_library', 'media_files', 'pick_media_files']) {
    if (!editor?.commands.allow.includes(command)) throw Error(`Missing permission: ${command}`)
}
const output = path.resolve('../output/FreeShow-Tauri-ImportFix.exe')
await fs.writeFile(output, exe)
const manifest = { output, bytes: exe.length, frontend: main, sha256: crypto.createHash('sha256').update(exe).digest('hex') }
await fs.writeFile('../output/FreeShow-Tauri-ImportFix-build.json', JSON.stringify(manifest, null, 2))
await fs.writeFile('../output/README-import-fix.txt', [
    'Close the previous Tauri build, then open FreeShow-Tauri-ImportFix.exe.',
    'PowerPoint: choose Import > PowerPoint and select a .pptx file. Save older .ppt files as .pptx first.',
    'Presentation media/fonts are extracted under your selected data folder/Imports/PowerPoint. Keep that folder for imported slide assets.',
    'Tested Tech Trends 2026 by Slidesgo.pptx: extracted 32 slides and 35 media/font entries; the original frontend converter added one show with all 32 slides.',
    'Converter failures now show an alert. Supported text and plain FreeShow imports remain available.',
    'PowerPoint uses the original FreeShow converter: some shapes, tables, graphs and text colors are imperfect; native PowerPoint animations are not preserved.',
    'PDF, bundled-media archives and binary database imports remain unfinished. This build does not resolve covered Edge/YouTube capture or the reported high memory usage.',
    'Rust extraction, seven bridge tests, a real frontend conversion test, production build and embedded-frontend/ACL checks passed. Native GUI validation is pending.'
].join('\r\n'))
console.log(JSON.stringify(manifest))
