import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
const exe = await fs.readFile('src-tauri/target/release/freeshow-tauri.exe')
const main = (await fs.readdir('dist-tauri/assets')).find(name => /^index-.*\.js$/.test(name))
if (!main || !exe.includes(Buffer.from(main))) throw Error('Release does not embed the current frontend')
const acl = JSON.parse(await fs.readFile('src-tauri/gen/schemas/acl-manifests.json', 'utf8'))
const editor = Object.values(acl).map(value=>value.permissions?.['allow-editor-commands']).find(Boolean)
for (const command of ['dropped_files','import_powerpoint','library_service','media_files']) {
    if (!editor?.commands.allow.includes(command)) throw Error(`Missing permission: ${command}`)
}
const config = JSON.parse(await fs.readFile('src-tauri/tauri.conf.json','utf8'))
if (config.app.windows.find(window=>window.label==='main')?.dragDropEnabled !== false) throw Error('Windows HTML dragging must be enabled')
const output = path.resolve('../output/FreeShow-Tauri-DragDropFix.exe')
await fs.writeFile(output,exe)
const manifest = {output,bytes:exe.length,frontend:main,sha256:crypto.createHash('sha256').update(exe).digest('hex')}
await fs.writeFile('../output/FreeShow-Tauri-DragDropFix-build.json',JSON.stringify(manifest,null,2))
await fs.writeFile('../output/README-drag-drop.txt',[
    'Close the previous Tauri build and open FreeShow-Tauri-DragDropFix.exe.',
    'Drag external files from Explorer into FreeShow. Supported document formats are routed to Import. Media can be dropped into projects, slides, editors, overlay/template cards and audio playlists.',
    'Dropping media on the library registers a media/audio folder. Dropping folders preserves their subfolders; choose Media or Audio before dropping a folder into the library.',
    'External files are copied under your selected data folder/Imports/Dropped using 256 KB chunks, without changing the originals. Keep that folder for media references. A drop is limited to 8 GB and directory trees to 10,000 entries/32 levels.',
    'Internal cards use HTML dragging with a FreeShow payload. Handled drops no longer propagate into surrounding drop areas.',
    'Dropping an image/video on an overlay adds media items behind its existing content. Dropping onto empty Overlays/Templates creates a new card/background.',
    'Tested: 16 enabled Rust tests; 11 frontend tests; real frontend browser fixtures for dropped text, slide media, overlay media, template backgrounds, audio playlists, media-library folders and mouse-driven internal overlay dragging. Folder traversal and chunk cancellation are tested separately. Production build and embedded frontend/ACL checks passed.',
    'Actual Explorer dragging in the native Windows app still needs a manual check. Unsupported document converters (PDF, Word, bundled archives and databases) remain unsupported and show a message; this is not complete beta-4 parity.',
    'The previous PowerPoint fix is included. Covered Edge/YouTube capture and the reported high memory usage remain unresolved.'
].join('\r\n'))
console.log(JSON.stringify(manifest))
