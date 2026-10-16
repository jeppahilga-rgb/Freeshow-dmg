import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
const exe = await fs.readFile('src-tauri/target/release/freeshow-tauri.exe')
const assets = await fs.readdir('dist-tauri/assets')
const main = assets.find(name => /^index-.*\.js$/.test(name))
if (!main || !exe.includes(Buffer.from(main))) throw Error('The release executable does not contain the current production frontend')
const acl = JSON.parse(await fs.readFile('src-tauri/gen/schemas/acl-manifests.json', 'utf8'))
const editor = Object.values(acl).map(value => value.permissions?.['allow-editor-commands']).find(Boolean)
for (const command of ['media_files', 'pick_media_files']) if (!editor?.commands.allow.includes(command)) throw Error(`Missing permission: ${command}`)
const output = path.resolve('../output/FreeShow-Tauri-MediaOverlays.exe')
await fs.writeFile(output, exe)
await fs.writeFile('../output/README-media-overlays.txt', [
    'FreeShow Tauri media/overlay repair build',
    'Close the older Tauri build, then run FreeShow-Tauri-MediaOverlays.exe.',
    'The executable embeds the production frontend and native media permissions; Vite is not required.',
    'The first launch in your current Tauri data folder consumes the prepared recovery request: 11 overlays, four media folders and one audio folder, with saved overlay categories and timers.',
    'Existing entries are preserved. Changed configuration files are backed up under Asset Recovery Backups in the data folder.',
    'Original FreeShow files are not modified.',
    'Native folder browsing, media existence/location checks, file selection, asset URLs and bounded thumbnail decoding are implemented. Overlay timers are cleaned up on destruction.',
    'Validation: 10 Rust tests, frontend production build, current frontend embedded in executable, and generated media ACL entries. Native visual playback still needs a check after launching the new build.',
    'Media decoding uses WebView2-supported formats; additional codec transcoding is not provided.'
].join('\r\n'))
console.log(JSON.stringify({output, bytes:exe.length, frontend:main, sha256:crypto.createHash('sha256').update(exe).digest('hex')}))
