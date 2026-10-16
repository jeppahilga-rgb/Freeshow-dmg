import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import assert from 'node:assert/strict'
const root=await fs.mkdtemp(path.join(os.tmpdir(),'freeshow-mac-core-'))
await fs.mkdir(path.join(root,'app'));await fs.mkdir(path.join(root,'Shows'))
const boot=path.join(root,'boot.json');await fs.writeFile(boot,JSON.stringify({libraryRoot:root,appData:path.join(root,'app'),hasConfig:false,paths:{userData:path.join(root,'app'),temp:root,documents:root,music:root,videos:root,pictures:root}}))
const runtime=path.resolve(process.env.FREESHOW_SMOKE_RUNTIME||'src-tauri/mac-runtime')
const child=spawn(path.join(runtime,'node'),[path.join(runtime,'backend.cjs')],{cwd:runtime,env:{...process.env,FREESHOW_BACKEND_CONFIG:boot},stdio:['pipe','pipe','pipe']})
const pending=new Map();let resolveReady,rejectReady;const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject});let stderr=''
child.stderr.on('data',b=>stderr+=b.toString());child.on('error',rejectReady);child.on('exit',code=>{if(code!==null)rejectReady(Error('Backend exited '+code+': '+stderr.slice(-2000)))})
createInterface({input:child.stdout}).on('line',line=>{try{const message=JSON.parse(line);if(message.type==='ready')resolveReady();if(message.type==='response')pending.get(message.id)?.(message)}catch{}})
let startupTimer
async function request(operation,data={}){const id=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error(operation+' timed out'))},30000);pending.set(id,message=>{clearTimeout(timer);pending.delete(id);message.error?reject(Error(message.error)):resolve(message.data)});child.stdin.write(JSON.stringify({id,operation,data})+'\n')})}
try{
 await Promise.race([ready,new Promise((_,reject)=>startupTimer=setTimeout(()=>reject(Error('Backend startup timed out: '+stderr.slice(-1000))),15000))]);clearTimeout(startupTimer)
 const providers=await request('GET_CONTENT_PROVIDERS');assert.equal(providers.length,5)
 const fonts=await request('GOOGLE_FONTS',{action:'inventory'});assert.ok(Array.isArray(fonts)&&fonts.length>0,'Mac installed font inventory must load')
 await request('SET_STORE_VALUE',{file:'config',key:'mac.coreSmoke',value:'passed'})
 assert.equal(await request('GET_STORE_VALUE',{file:'config',key:'mac.coreSmoke'}),'passed')
 await assert.rejects(request('SET_STORE_VALUE',{file:'config',key:'__proto__.bad',value:1}),/Invalid/)
 console.log('PASS bundled ARM Node runtime: startup, provider inventory, installed fonts, isolated settings and invalid-key rejection')
}finally{clearTimeout(startupTimer);child.kill();await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)resolve();else child.once('exit',resolve)});await fs.rm(root,{recursive:true,force:true})}
