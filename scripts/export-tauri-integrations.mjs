import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const exe = await fs.readFile('src-tauri/target/release/freeshow-tauri.exe')
const assets = await fs.readdir('dist-tauri/assets')
const main = assets.find(name => /^index-.*\.js$/.test(name))
if (!main || !exe.includes(Buffer.from(main))) throw Error('Release does not embed the current production frontend')
const acl = JSON.parse(await fs.readFile('src-tauri/gen/schemas/acl-manifests.json', 'utf8'))
const editor = Object.values(acl).map(value => value.permissions?.['allow-editor-commands']).find(Boolean)
for (const command of ['library_service', 'export_library', 'media_files', 'pick_media_files']) {
    if (!editor?.commands.allow.includes(command)) throw Error(`Missing native permission: ${command}`)
}
const output = path.resolve('../output/FreeShow-Tauri-Integrations.exe')
await fs.writeFile(output, exe)
const manifest = { output, bytes: exe.length, frontend: main, sha256: crypto.createHash('sha256').update(exe).digest('hex') }
await fs.writeFile('../output/FreeShow-Tauri-Integrations-build.json', JSON.stringify(manifest, null, 2))
await fs.writeFile('../output/README-integrations.txt', [
    'FreeShow Tauri: library, Scripture and file integrations',
    'Close the previous Tauri executable, then open FreeShow-Tauri-Integrations.exe.',
    'The prepared recovery merges the missing Stage layout, categories, Bible registrations, styles and effects on first launch. Existing IDs are preserved and active configuration files are backed up.',
    'Your Tagalog Bible was copied into the separate Tauri library; the original library remains unchanged.',
    'Added: local Bible reads and saving; Bible folder discovery; file information; UTF-8/UTF-16 text file reads; audio tags, duration and ReplayGain peak limiting.',
    'Added: FreeShow plain JSON imports, TXT/CSV/ChordPro and supported existing text/XML converters. Binary documents, archive imports and binary database formats remain unsupported.',
    'Added: plain FreeShow show, project, template, overlay, theme, action and Stage-layout exports. Exports go into the selected data folder/Exports. Existing export files are preserved by numbering. Bundled-media exports remain unsupported.',
    'The production frontend is embedded. Vite is not required.',
    'Validation: Rust tests including the real read-only Tagalog Bible; frontend bridge protocol tests; production frontend build; embedded-frontend and native ACL checks.',
    'Native visual operation still needs validation after launch.',
    'This is still a partial port: PDF/PowerPoint/bundled-media conversion, backup/update services, production transports/recording, MIDI/timecode, cloud providers and AI remain unfinished. Covered Edge/YouTube capture and high RAM usage remain unresolved.'
].join('\r\n'))
console.log(JSON.stringify(manifest))
