import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
const exe = await fs.readFile('src-tauri/target/release/freeshow-tauri.exe')
const frontend = (await fs.readdir('dist-tauri/assets')).find(name => /^index-.*\.js$/.test(name))
if (!frontend || !exe.includes(Buffer.from(frontend))) throw Error('Release does not embed the current frontend')
const output = path.resolve('../output/FreeShow-Tauri-Website-Spotify.exe')
await fs.writeFile(output, exe)
const manifest = { output, bytes: exe.length, frontend, builtAt: new Date().toISOString(), sha256: crypto.createHash('sha256').update(exe).digest('hex') }
await fs.writeFile('../output/FreeShow-Tauri-Website-Spotify-build.json', JSON.stringify(manifest, null, 2))
console.log(JSON.stringify(manifest))

