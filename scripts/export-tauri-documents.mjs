import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
const exe = await fs.readFile('src-tauri/target/release/freeshow-tauri.exe')
const frontend = (await fs.readdir('dist-tauri/assets')).find(name=>/^index-.*\.js$/.test(name))
if (!frontend || !exe.includes(Buffer.from(frontend))) throw Error('Release does not embed the current frontend')
const acl=JSON.parse(await fs.readFile('src-tauri/gen/schemas/acl-manifests.json','utf8'))
const permission=Object.values(acl).map(v=>v.permissions?.['allow-editor-commands']).find(Boolean)
if (!permission?.commands.allow.includes('document_pdf')) throw Error('Missing document import permission')
const output=path.resolve('../output/FreeShow-Tauri-DocumentFix.exe')
await fs.writeFile(output,exe)
const manifest={output,bytes:exe.length,frontend,sha256:crypto.createHash('sha256').update(exe).digest('hex')}
await fs.writeFile('../output/FreeShow-Tauri-DocumentFix-build.json',JSON.stringify(manifest,null,2))
await fs.writeFile('../output/README-document-fix.txt',[
    'Close the previous Tauri build and open FreeShow-Tauri-DocumentFix.exe.',
    'Import > PowerPoint now renders slides through installed Microsoft PowerPoint on Windows. Older .ppt files also use this path. PowerPoint must be installed.',
    'Import > PDF works without Microsoft Office. Explorer drops of PDF/PPTX use the same import paths.',
    'Each page becomes a static PNG slide background, with its longest dimension at 2160 pixels. Text/graphics are flattened; animations, embedded videos and editable PowerPoint text are not retained.',
    'Pages are rendered sequentially, with import progress and visible error messages. Files are saved under your selected data folder/Imports/Dropped; keep those files for the slides. Source documents are read-only and temporary conversion PDFs are removed.',
    'PDFs are limited to 256 MB and 1000 pages. Encrypted/password-protected PDFs are not supported by this import UI. PowerPoint conversion timeout is three minutes.',
    'This build includes the previous drag/drop and integration fixes. Native app picker/Explorer verification is still pending; broader beta-4 feature parity, covered Edge video capture and high-memory workloads remain unresolved.'
].join('\r\n'))
console.log(JSON.stringify(manifest))
