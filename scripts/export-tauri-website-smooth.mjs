import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
const exe = await fs.readFile('src-tauri/target/release/freeshow-tauri.exe')
if (!exe.includes(await fs.readFile('src-tauri/src/shared_website.js'))) throw Error('Missing current website script')
const frontend = (await fs.readdir('dist-tauri/assets')).find(name => /^index-.*\.js$/.test(name))
if (!frontend || !exe.includes(Buffer.from(frontend))) throw Error('Missing current frontend')
const output = path.resolve('../output/FreeShow-Tauri-Website-Smooth.exe')
await fs.writeFile(output, exe)
const manifest = { output, bytes: exe.length, frontend, builtAt: new Date().toISOString(), sha256: crypto.createHash('sha256').update(exe).digest('hex') }
await fs.writeFile('../output/FreeShow-Tauri-Website-Smooth-build.json', JSON.stringify(manifest, null, 2))
console.log(JSON.stringify(manifest))


