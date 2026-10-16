import fs from 'node:fs'
import readline from 'node:readline'
import {handlers} from './handlers'
import {outputs} from './output-state'
;(process as any).resourcesPath = __dirname
import {reply} from './ipc'
import {serveProtected} from './protected-protocol'
import {importBinary} from './imports'
import {mediaTransport} from './media-transport'
import {mediaChannel} from './media-channels'
import {outputEngine,engineRate} from './output-engines'
import {closeEngineAudio} from './audio-engine'
import {whipSignal} from './whip-host'
import {legacyCloud} from './legacy-cloud'
import {mediaSubtitles} from './subtitles'
import {googleFonts} from './google-fonts'
const output=process.stdout.write.bind(process.stdout)
const send=(message:any)=>{const encoded=JSON.stringify(message,(_key,v)=>v?.type==='Buffer'&&Array.isArray(v.data)?{__fsBytes:Buffer.from(v.data).toString('base64')}:v);if(Buffer.byteLength(encoded,'utf8')>60*1024*1024)throw Error('Backend result is too large to transfer; split the import or export into smaller batches');output(encoded+'\n')}
for(const method of ['log','info','warn','error','debug'] as const)console[method]=()=>{}
const nativePending=new Map<string,(data:any)=>void>()
;(globalThis as any).__fsEvent=(channel:string,msg:any,id?:string)=>send({type:'event',channel,msg,id})
;(globalThis as any).__fsNative=(operation:string,data:any)=>new Promise((resolve,reject)=>{const id=crypto.randomUUID();const timer=setTimeout(()=>{nativePending.delete(id);reject(Error('Native desktop operation timed out'))},120000);nativePending.set(id,response=>{clearTimeout(timer);response.error?reject(Error(response.error)):resolve(response.data)});send({type:'native',id,operation,data})})
readline.createInterface({input:process.stdin}).on('line',async line=>{try{if(line.length>64*1024*1024)throw Error('Backend request too large');const message=JSON.parse(line,(_key,v)=>v?.__fsBytes?Buffer.from(v.__fsBytes,'base64'):v);if(message.type==='native-reply'){nativePending.get(message.id)?.(message);nativePending.delete(message.id);return}if(message.operation==='REPLY'){reply(message.data.id,message.data.msg);send({type:'response',id:message.id,data:null});return}const handler=message.operation==='GOOGLE_FONTS'?googleFonts:message.operation==='MEDIA_SUBTITLES'?mediaSubtitles:message.operation==='LEGACY_CLOUD'?legacyCloud:message.operation==='WHIP_SIGNAL'?whipSignal:message.operation==='AUDIO_CLOSE'?closeEngineAudio:message.operation==='ENGINE_RATE'?engineRate:message.operation==='OUTPUT_ENGINE'?outputEngine:message.operation==='MEDIA_CHANNEL'?mediaChannel:message.operation==='MEDIA_TRANSPORT'?mediaTransport:message.operation==='IMPORT_BINARY'?importBinary:message.operation==='PROTECTED_MEDIA'?serveProtected:(handlers as any)[message.operation];if(!handler)throw Error('Unknown backend service '+message.operation);if(message.operation==='START_SLIDESHOW'){const active:any=await (globalThis as any).__fsNative('GET_OUTPUTS',{});for(const output of active||[])outputs.set(output.id,{...outputs.get(output.id),...output})}const result=await handler(message.data,{sender:{id:1},reply:(channel:string,msg:any,id?:string)=>(globalThis as any).__fsEvent(channel,msg,id)});send({type:'response',id:message.id,data:result??null})}catch(error:any){let id;try{id=JSON.parse(line).id}catch{}send({type:'response',id,error:String(error?.message||error).slice(0,2048)})}})
send({type:'ready'})
