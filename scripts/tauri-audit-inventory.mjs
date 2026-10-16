import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
const main=await fs.readFile('src/types/IPC/Main.ts','utf8')
const bridge=await fs.readFile('src/frontend/tauri/bridge.ts','utf8')
const section=main.slice(main.indexOf('export enum Main {'),main.indexOf('\n}',main.indexOf('export enum Main {')))
const commands=[...section.matchAll(/\b\w+\s*=\s*"([A-Z_0-9]+)"/g)].map(m=>m[1])
const mentioned=new Set([...bridge.matchAll(/"([A-Z_0-9]+)"/g)].map(m=>m[1]))
const absent=commands.filter(command=>!mentioned.has(command))
const files=[]
async function scan(folder){for(const entry of await fs.readdir(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isDirectory())await scan(file);else if(/\.(ts|svelte)$/.test(entry.name))files.push(file)}}
await scan('src/frontend')
const calls={}
for(const file of files){const lines=(await fs.readFile(file,'utf8')).split(/\r?\n/);lines.forEach((line,i)=>{for(const command of absent)if(line.includes(`Main.${command}`)&&(new RegExp(`Main\\.${command}\\b`)).test(line))(calls[command]??=[]).push(`${file.replaceAll('\\','/')}:${i+1}`)})}
const exe=await fs.readFile('../output/FreeShow-Tauri-EditablePPTX.exe')
const result={date:'2026-10-10',artifact:'FreeShow-Tauri-EditablePPTX.exe',sha256:crypto.createHash('sha256').update(exe).digest('hex'),mainCommands:commands.length,absentFromBridge:absent.length,method:'Static MAIN command coverage. Absent literals indicate no matching bridge route; direct Tauri APIs and renderer-only features are outside this count. References include types/imports, so this is a triage inventory, not a count of broken UI buttons.',unrouted:absent.map(command=>({command,references:calls[command]||[]}))}
await fs.writeFile('../output/tauri-audit-command-inventory.json',JSON.stringify(result,null,2))
console.log(JSON.stringify({mainCommands:commands.length,absentFromBridge:absent.length,sha256:result.sha256}))
