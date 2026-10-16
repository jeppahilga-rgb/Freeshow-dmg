import fs from 'node:fs/promises'
const source=await fs.readFile('src/types/IPC/Main.ts','utf8'),bridge=await fs.readFile('src/frontend/tauri/bridge.ts','utf8'),desktop=await fs.readFile('src/frontend/tauri/desktopServices.ts','utf8')
const begin=source.indexOf('export enum Main {'),section=source.slice(begin,source.indexOf('\n}',begin)).replace(/\/\/[^\n]*/g,'')
const commands=[...section.matchAll(/\b\w+\s*=\s*"([A-Z_0-9]+)"/g)].map(m=>m[1])
const original=new Set(JSON.parse(await fs.readFile('src-tauri/backend-runtime/commands.json','utf8')))
const native=new Set([...desktop.matchAll(/'([A-Z_0-9]+)'/g)].map(m=>m[1]))
const routes=new Set([...bridge.matchAll(/["']([A-Z_0-9]+)["']/g)].map(m=>m[1]))
const unknown=commands.filter(command=>!original.has(command)&&!native.has(command)&&!routes.has(command))
const report={date:new Date().toISOString(),mainCommands:commands.length,originalBackendHandlers:original.size,commandsWithoutDetectedRoute:unknown,method:'Static routing inventory only; detected routes do not establish feature correctness.',validation:{bridgeTests:46,nativeTests:32,skippedNativeTests:3,liveMediaTests:['NDI sender/receiver and renderer reconnect','OMT sender/receiver','RTMP output from a silent slide','WHIP HTTP signaling and cleanup','WHIP video publishing and WebRTC decoding through MediaMTX'],limitations:['WHIP audio still needs end-to-end validation','Blackmagic hardware not available','External cloud, provider and AI accounts not exercised','Automatic update requires a Tauri release feed and signing configuration','Installed app remains the older build until this installer is installed']}}
await fs.writeFile('../output/tauri-port-inventory.json',JSON.stringify(report,null,2))
console.log(JSON.stringify({commands:commands.length,original:original.size,withoutDetectedRoute:unknown}))
