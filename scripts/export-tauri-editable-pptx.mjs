import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
const exe=await fs.readFile('src-tauri/target/release/freeshow-tauri.exe')
const frontend=(await fs.readdir('dist-tauri/assets')).find(name=>/^index-.*\.js$/.test(name))
if (!frontend || !exe.includes(Buffer.from(frontend))) throw Error('Release does not embed the current frontend')
const acl=JSON.parse(await fs.readFile('src-tauri/gen/schemas/acl-manifests.json','utf8'))
const editor=Object.values(acl).map(v=>v.permissions?.['allow-editor-commands']).find(Boolean)
for(const command of ['import_powerpoint','document_pdf','dropped_files']) if(!editor?.commands.allow.includes(command))throw Error('Missing permission: '+command)
const output=path.resolve('../output/FreeShow-Tauri-EditablePPTX.exe')
await fs.writeFile(output,exe)
const manifest={output,bytes:exe.length,frontend,sha256:crypto.createHash('sha256').update(exe).digest('hex')}
await fs.writeFile('../output/FreeShow-Tauri-EditablePPTX-build.json',JSON.stringify(manifest,null,2))
await fs.writeFile('../output/README-editable-pptx.txt',[
    'Close the old Tauri build and open FreeShow-Tauri-EditablePPTX.exe. Re-import your PPTX to apply the fixes.',
    'Import > PowerPoint and dropped .pptx files again produce editable FreeShow text, shapes and media without PDF conversion or requiring installed PowerPoint.',
    'Improved group/nested-group offsets and scaling; valid rotation/flip CSS; preserved text-box/paragraph attributes; explicit no-bullet setting; preset picture frames now retain photos, with ellipse/rounded-rectangle clipping.',
    'Extracted fonts use the Tauri asset protocol and local-only loading. Raw supported TrueType/OpenType fonts can load, but the compressed embedded EOT fonts in the Slidesgo deck cannot currently be decoded. Install matching fonts to improve appearance; no automatic font installation or downloading is performed.',
    'PDF import remains separate and renders image backgrounds. The explicit PowerPoint-to-PDF action remains available for flattened imports with installed PowerPoint.',
    'This is improved editable import, not full 1:1 PowerPoint fidelity. Tables/charts, some custom geometry and effects, grouped rotation/font scaling, animations and compressed embedded fonts still have limitations. Older binary .ppt files must be saved as .pptx for editable import.',
    'Testing: 14 frontend unit checks plus real Slidesgo 32-slide editable conversion/asset loading. Native GUI testing remains pending. Original source/library files are unchanged.'
].join('\r\n'))
console.log(JSON.stringify(manifest))
