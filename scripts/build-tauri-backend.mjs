import fs from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'
import {build} from 'esbuild'
const directory=path.resolve('src-tauri/backend-runtime')
const whipSource=ts.createSourceFile('WebRtcHost.ts',await fs.readFile('src/electron/streaming/WebRtcHost.ts','utf8'),ts.ScriptTarget.Latest,true)
const whipClass=whipSource.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==='WebRtcHost')
const whipMethod=whipClass.members.find(node=>node.name?.getText(whipSource)==='buildHostHtml')
let whipHtml=whipMethod.body.statements.find(ts.isReturnStatement).expression.text
if(!whipHtml?.includes('const { ipcRenderer } = require("electron");'))throw Error('Review the upstream WHIP host before rebuilding')
const whipAdapter=`const listeners = new Map();
const ipcRenderer = {on:(channel,fn)=>listeners.set(channel,fn),send:(channel,data)=>parent.postMessage({kind:'FREESHOW_WHIP_SIGNAL',channel,data},parent.location.origin)};
window.addEventListener('message',event=>{if(event.source!==parent)return;const message=event.data;if(message.channel==='CONNECT'){const url=new URL(message.data.url);if(url.protocol!=='ws:'||url.hostname!=='127.0.0.1')return;const socket=new WebSocket(url);socket.binaryType='arraybuffer';socket.onmessage=event=>{const bytes=new Uint8Array(event.data);if(bytes.length<4)return;const length=new DataView(bytes.buffer).getUint32(0,true);if(length>65536||4+length>bytes.length)return;const message=JSON.parse(new TextDecoder().decode(bytes.subarray(4,4+length)));message.data.buffer=bytes.subarray(4+length);listeners.get(message.channel)?.(null,message.data)};window.addEventListener('pagehide',()=>socket.close(),{once:true})}else listeners.get(message.channel)?.(null,message.data)});`
whipHtml=whipHtml.replace('const { ipcRenderer } = require("electron");',whipAdapter).replace('(_event, { buffer, sampleRate, channelCount })','(_event, { buffer, sampleRate, channelCount, outputId })').replace('const streamKeys = Object.keys(streams);','const streamKeys = Object.keys(streams).filter(id=>!outputId||id===outputId);')
await fs.writeFile(path.join(directory,'whip-host.html'),whipHtml)
const keys=['CAN_SYNC','GET_TEAMS','CLOUD_DATA','CLOUD_SYNC','RESTORE_CLOUD_BACKUP','GET_CONVERSATION_ID','SEND_SOCKET_MESSAGE','PROVIDER_LOAD_SERVICES','PROVIDER_CONNECTIONS','PROVIDER_DISCONNECT','PROVIDER_STARTUP_LOAD','PROVIDER_FETCH_FOLDERS','PCO_LIVE_GET','PCO_PUSHER_AUTH','PCO_FETCH_SERVICE_TREE','PCO_LOAD_PLAN','ONSTAGE_LOAD_SERVICE','ONSTAGE_GET_TEAMS','ONSTAGE_SWITCH_TEAM','GET_CONTENT_PROVIDERS','GET_CONTENT_LIBRARY','GET_PROVIDER_CONTENT','CHECK_MEDIA_LICENSE','FFMPEG_DOWNLOAD','ENCODER_DETECT','SET_RTMP_ENCODER','AI_GET_MODELS','AI_GET_BIN','AI_LISTEN_START','AI_LISTEN_STOP','AI_AUDIO_DATA','AI_GET_STATUS','AI_SETUP','AI_SET_KEY','AI_LLM_COMPLETE','TIMECODE_START','TIMECODE_STOP','TIMECODE_VALUE','TIMECODE_AUDIO_DATA','TIMECODE_STATUS','DOWNLOAD_LESSONS_MEDIA','MEDIA_DOWNLOAD','MEDIA_IS_DOWNLOADED','READ_EXIF','GET_SIMILAR','BUNDLE_MEDIA_FILES','GET_STORE_VALUE','SET_STORE_VALUE']
const original=path.resolve('src/electron/IPC/responsesMain.ts')
keys.push('DEVICE_ID','SLIDESHOW_GET_APPS','START_SLIDESHOW','PRESENTATION_CONTROL')
const source=ts.createSourceFile(original,await fs.readFile(original,'utf8'),ts.ScriptTarget.Latest,true)
const declaration=source.statements.flatMap(s=>ts.isVariableStatement(s)?[...s.declarationList.declarations]:[]).find(d=>d.name.getText(source)==='mainResponses')
const props=declaration.initializer.properties.filter(p=>keys.includes(p.name?.expression?.name?.text))
const helpers=source.statements.filter(n=>ts.isFunctionDeclaration(n)&&['getConversationId','sendSocketMessage'].includes(n.name?.text))
const used=new Set();for(const prop of [...props,...helpers]){const visit=n=>{if(ts.isIdentifier(n))used.add(n.text);ts.forEachChild(n,visit)};visit(prop)}
const imports=[]
for(const s of source.statements){if(!ts.isImportDeclaration(s)||!s.importClause||s.importClause.isTypeOnly)continue;const clause=s.importClause;let names=[];if(clause.namedBindings&&ts.isNamedImports(clause.namedBindings))names=clause.namedBindings.elements.filter(n=>!n.isTypeOnly&&used.has(n.name.text)).map(n=>n.getText(source));const defaultName=clause.name&&used.has(clause.name.text)?clause.name.text:'';if(!names.length&&!defaultName)continue;let module=s.moduleSpecifier.text;if(module.startsWith('.'))module=path.resolve(path.dirname(original),module).replaceAll('\\','/');imports.push(`import ${[defaultName,names.length?'{'+names.join(',')+'}':''].filter(Boolean).join(',')} from ${JSON.stringify(module)}`)}
await fs.writeFile(path.join(directory,'handlers.ts'),imports.join('\n')+'\n'+helpers.map(n=>n.getText(source)).join('\n')+'\nexport const handlers = {\n'+props.map(p=>p.getText(source)).join(',\n')+'\n}\n')
await fs.writeFile(path.join(directory,'commands.json'),JSON.stringify(keys,null,2))
const storeFile=path.resolve('src/electron/data/store.ts'),store=ts.createSourceFile(storeFile,await fs.readFile(storeFile,'utf8'),ts.ScriptTarget.Latest,true)
const meta=store.statements.flatMap(s=>ts.isVariableStatement(s)?[...s.declarationList.declarations]:[]).find(d=>d.name.getText(store)==='storeFilesData')
await fs.writeFile(path.join(directory,'store-metadata.ts'),'import {defaultSettings,defaultSyncedSettings} from "../../src/electron/data/defaults"\nconst clone=structuredClone\nexport const storeFilesData='+meta.initializer.getText(store)+'\n')
const shimMap=new Map(['data/store','IPC/main','IPC/responsesMain','data/thumbnails','index','capture/CaptureHelper','output/OutputHelper'].map((name,i)=>[path.resolve('src/electron',name),path.join(directory,['store.ts','ipc.ts','services.ts','services.ts','index.ts','capture.ts','capture.ts'][i])]))
shimMap.set(path.resolve('src/electron/capture/StreamReceiverHost'),path.join(directory,'media-transport.ts'))
shimMap.set(path.resolve('src/electron/output/helpers/OutputValues'),path.join(directory,'output-values.ts'))
const macOptional=process.env.FREESHOW_MAC_NATIVE==='1'?['osr-capture']:['slideshow','@discordjs/opus','libltc-wrapper','jazz-midi','sherpa-onnx-node','grandiose','openmediatransport','macadam','osr-capture']
const plugin={name:'tauri-backend-host',setup(b){
 if(process.env.FREESHOW_MAC_CORE==='1'){
  b.onResolve({filter:/.*/},args=>macOptional.includes(args.path)?{path:args.path,namespace:'mac-core-unavailable'}:undefined)
  b.onLoad({filter:/.*/,namespace:'mac-core-unavailable'},args=>({contents:`const unavailable = new Proxy(function(){throw Error(${JSON.stringify(args.path+' is not available in this Mac core preview.')})},{get(target,key){if(key==='__esModule')return false;if(key==='then')return undefined;return unavailable;}});module.exports=unavailable;`,loader:'js'}))
 }
 b.onResolve({filter:/.*/},args=>{if(args.path==='better-sqlite3')return {path:path.join(directory,'sqlite.ts')};if(args.path==='electron')return {path:path.join(directory,'electron.ts')};if(args.path.startsWith('.')||path.isAbsolute(args.path)){let candidate=path.resolve(args.resolveDir,args.path).replace(/\.ts$/,'');if(candidate===path.resolve('src/electron'))candidate=path.join(candidate,'index');if(shimMap.has(candidate))return {path:shimMap.get(candidate)}}})
 b.onLoad({filter:/[\\/]data[\\/]import\.ts$/},async args=>{
  let contents=(await fs.readFile(args.path,'utf8')).replace('join(__dirname, "..", "..", "..", "public", "proto", "presentation.proto")','join(__dirname, "proto", "presentation.proto")')
  contents=contents.replace('await decompressZip(zipFiles)','await decompressZip(zipFiles, true)').replace('if (customContent) (fileData as FileData).content = customContent','if (customContent) (fileData as FileData).content = customContent; else if (Buffer.isBuffer((fileData as FileData).content)) (fileData as FileData).content = ((fileData as FileData).content as Buffer).toString("utf8")')
  contents=contents.replace('if (data.length) {','if (!data.length) throw Error("The selected archive contains no importable files"); if (data.length) {').replace('if (!data.length) return','if (!data.length) throw Error("No content could be imported from the selected files")')
  return {contents,loader:'ts'}
 })
 b.onLoad({filter:/[\\/]utils[\\/]files\.ts$/},async args=>({contents:(await fs.readFile(args.path,'utf8')).replace('thumbnailPath = createThumbnail(filePath)','thumbnailPath = await createThumbnail(filePath)'),loader:'ts'}))
 b.onLoad({filter:/[\\/]data[\\/]protected\.ts$/},async args=>({contents:(await fs.readFile(args.path,'utf8'))+'\nexport const tauriProtectedEntries = protectedEntries; export const tauriDeriveKey = deriveKey;\n',loader:'ts'}))
}}
const oauthPlugin={name:'tauri-loopback-oauth',setup(b){b.onLoad({filter:/[\\/]contentProviders[\\/].*[Cc]onnect\.ts$/},async args=>({contents:(await fs.readFile(args.path,'utf8')).replace(/\.listen\(([^,\n]+),\s*\(\)\s*=>/g,'.listen($1, "127.0.0.1", () =>'),loader:'ts'}))}}
await fs.mkdir(path.join(directory,'build'),{recursive:true})
await build({entryPoints:[path.join(directory,'entry.ts')],outfile:path.join(directory,'build/backend.cjs'),bundle:true,platform:'node',target:'node24',format:'cjs',plugins:[plugin,oauthPlugin],external:['slideshow','@discordjs/opus','libltc-wrapper','jazz-midi','sherpa-onnx-node','grandiose','openmediatransport','macadam','osr-capture'],metafile:true,logLevel:'warning'}).then(r=>fs.writeFile(path.join(directory,'build/metafile.json'),JSON.stringify(r.metafile)))
console.log('Bundled original backend handlers:',keys.length)
await fs.cp('public/proto',path.join(directory,'build/proto'),{recursive:true})
await build({entryPoints:[path.resolve('src/electron/ai/stt/models/nemotronWorker.ts')],outfile:path.join(directory,'build/nemotronWorker.js'),bundle:true,platform:'node',target:'node24',format:'cjs',plugins:[plugin],external:['sherpa-onnx-node'],banner:{js:`process.parentPort = { postMessage: message => process.send?.(message), on: (event, callback) => process.on(event, data => callback({data})) };`},logLevel:'warning'})
for(const [source,target] of [['src/electron/capture/streamReceiverProcess.ts','streamReceiverProcess.js'],['src/electron/ndi/ndiWorker.ts','ndiWorker.js'],['src/electron/omt/omtWorker.ts','omtWorker.js']])await build({entryPoints:[path.resolve(source)],outfile:path.join(directory,'build',target),bundle:true,platform:'node',target:'node24',format:'cjs',plugins:[plugin],external:['grandiose','openmediatransport','osr-capture'],banner:{js:`for (const method of ['log','info','warn','error','debug']) console[method] = () => {}; `+(target==='streamReceiverProcess.js'?`const fsWorkerPort = require('node:worker_threads').parentPort; process.parentPort = { postMessage: message => fsWorkerPort.postMessage(message), on: (event, callback) => fsWorkerPort.on(event, data => callback({data, ports:data.__ports})) };`:'')},logLevel:'warning'})
