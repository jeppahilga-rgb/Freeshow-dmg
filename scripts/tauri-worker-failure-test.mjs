import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import assert from 'node:assert/strict'
const root=await fs.mkdtemp(path.join(os.tmpdir(),'freeshow-worker-failure-'))
await fs.mkdir(path.join(root,'app'));await fs.mkdir(path.join(root,'Shows'))
await fs.copyFile('src-tauri/backend-runtime/build/backend.cjs',path.join(root,'backend.cjs'))
const dummy=`const {parentPort}=require('node:worker_threads');parentPort.on('message',message=>{if(message.type==='create'){parentPort.postMessage({type:'status',id:message.id,status:'connected',connections:1});setTimeout(()=>process.exit(1),100)}})`
for(const name of ['ndiWorker.js','omtWorker.js'])await fs.writeFile(path.join(root,name),dummy)
await fs.writeFile(path.join(root,'boot.json'),JSON.stringify({libraryRoot:root,appData:path.join(root,'app'),paths:{userData:path.join(root,'app'),temp:root,documents:root,music:root,videos:root,pictures:root}}))
const child=spawn(process.execPath,[path.join(root,'backend.cjs')],{env:{...process.env,NODE_PATH:path.resolve('node_modules'),FREESHOW_BACKEND_CONFIG:path.join(root,'boot.json')},windowsHide:true,stdio:['pipe','pipe','pipe']})
let buffer='',resolveReady;const ready=new Promise(r=>resolveReady=r),requests=new Map(),events=[],rates=[]
const send=message=>child.stdin.write(JSON.stringify(message)+'\n')
child.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const message=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(message.type==='ready')resolveReady();if(message.type==='event')events.push(message);if(message.type==='response')requests.get(message.id)?.(message);if(message.type==='native'){if(message.operation==='ENGINE_FRAMERATE')rates.push(message.data);send({type:'native-reply',id:message.id,data:null})}}})
child.stderr.on('data',chunk=>process.stderr.write(chunk))
async function request(operation,data){return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>reject(Error('Request timeout')),10000);requests.set(id,message=>{clearTimeout(timer);requests.delete(id);message.error?reject(Error(message.error)):resolve(message.data)});send({id,operation,data})})}
let startupTimer
try{
 await Promise.race([ready,new Promise((_,reject)=>startupTimer=setTimeout(()=>reject(Error('Startup timeout')),15000))]);clearTimeout(startupTimer)
 for(const engine of ['NDI','OMT']){
  const id='failed-'+engine.toLowerCase()
  await request('OUTPUT_ENGINE',{output:{id,[engine.toLowerCase()]:true,[engine.toLowerCase()+'Data']:{framerate:30}},active:true})
  const deadline=Date.now()+5000;while(Date.now()<deadline&&!events.some(event=>event.msg?.channel==='ALERT'&&event.msg.data.includes(engine+' output worker stopped')))await new Promise(r=>setTimeout(r,50))
  assert.ok(events.some(event=>event.msg?.channel==='ALERT'&&event.msg.data.includes(engine+' output worker stopped')))
  assert.deepEqual(rates.filter(rate=>rate.id===id).map(rate=>rate.fps),[30,1])
  await request('OUTPUT_ENGINE',{id,active:false})
  console.log('PASS: '+engine+' worker exit reports failure and reduces capture from 30 to 1 fps')
 }
}finally{
 clearTimeout(startupTimer);child.kill();if(child.exitCode===null&&child.signalCode===null)await once(child,'exit')
 const target=path.resolve(root);if(!target.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(target).startsWith('freeshow-worker-failure-'))throw Error('Unsafe cleanup')
 await fs.rm(target,{recursive:true,force:true})
}
