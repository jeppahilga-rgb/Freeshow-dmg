import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import assert from 'node:assert/strict'
const root=await fs.mkdtemp(path.join(os.tmpdir(),'freeshow-rtmp-output-test-')),app=path.join(root,'app')
await fs.mkdir(app);await fs.mkdir(path.join(root,'Shows'))
await fs.writeFile(path.join(root,'boot.json'),JSON.stringify({libraryRoot:root,appData:app,paths:{userData:app,temp:root,documents:root,music:root,videos:root,pictures:root}}))
async function freePort(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p}
const rtmp=await freePort(),api=await freePort()
await fs.writeFile(path.join(root,'server.yml'),`logLevel: error\nrtmpAddress: 127.0.0.1:${rtmp}\napi: yes\napiAddress: 127.0.0.1:${api}\nrtsp: no\nhls: no\nwebrtc: no\nsrt: no\npaths:\n  cam:\n`)
const server=spawn(path.resolve('src-tauri/mediamtx/mediamtx.exe'),[path.join(root,'server.yml')],{windowsHide:true,stdio:['ignore','ignore','pipe']})
server.stderr.on('data',d=>process.stderr.write(d))
const child=spawn(process.execPath,['src-tauri/backend-runtime/build/backend.cjs'],{env:{...process.env,FREESHOW_BACKEND_CONFIG:path.join(root,'boot.json')},windowsHide:true,stdio:['pipe','pipe','pipe']})
let buffer='',readyResolve;const ready=new Promise(resolve=>readyResolve=resolve),waiting=new Map()
const send=message=>child.stdin.write(JSON.stringify(message)+'\n')
child.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const message=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(message.type==='ready')readyResolve();if(message.type==='response')waiting.get(message.id)?.(message);if(message.type==='native')send({type:'native-reply',id:message.id,data:null})}})
child.stderr.on('data',d=>process.stderr.write(d))
async function request(operation,data){return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{waiting.delete(id);reject(Error(operation+' timed out'))},20000);waiting.set(id,message=>{clearTimeout(timer);waiting.delete(id);message.error?reject(Error(message.error)):resolve(message.data)});send({id,operation,data})})}
let timer,publish,producer,probe
try{
 await Promise.race([ready,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Startup timeout')),15000))]);clearTimeout(timer)
 for(let i=0;i<50;i++){try{if((await fetch(`http://127.0.0.1:${api}/v3/paths/list`)).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 const id='rtmp-output-regression',width=160,height=90
 await request('SET_RTMP_ENCODER',{outputId:id,encoder:'x264'})
 const engine=await request('OUTPUT_ENGINE',{output:{id,rtmp:true,forcedResolution:{width,height},rtmpData:{streaming:true,fps:10,bitrate:500,destinations:[{id:'local',url:`rtmp://127.0.0.1:${rtmp}`,key:'cam',enabled:true}]}},active:true})
 producer=net.connect(engine.port,'127.0.0.1');await once(producer,'connect')
 function packet(bytes){const h=Buffer.alloc(4);h.writeUInt32LE(bytes.length);producer.write(Buffer.concat([h,bytes]))}
 packet(Buffer.from(JSON.stringify({id,token:engine.token})))
 const pixels=Buffer.alloc(width*height*4);for(let i=0;i<pixels.length;i+=4){pixels[i+1]=200;pixels[i+3]=255}
 const h=Buffer.alloc(8);h.writeUInt32LE(width);h.writeUInt32LE(height,4);const frame=Buffer.concat([h,pixels])
 packet(frame);publish=setInterval(()=>packet(frame),100)
 let active;for(let i=0;i<150;i++){const res=await fetch(`http://127.0.0.1:${api}/v3/paths/get/cam`);if(res.ok){const data=await res.json();if(data.ready){active=data;break}}await new Promise(r=>setTimeout(r,100))}
 assert.ok(active,'Silent slide never published RTMP')
 probe=spawn('ffmpeg',['-hide_banner','-loglevel','error','-i',`rtmp://127.0.0.1:${rtmp}/cam`,'-an','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true,stdio:['ignore','pipe','pipe']})
 const chunks=[];probe.stdout.on('data',d=>chunks.push(d));let error='';probe.stderr.on('data',d=>error+=d)
 const probeTimer=setTimeout(()=>probe.kill(),12000);const [code]=await once(probe,'exit');clearTimeout(probeTimer)
 assert.equal(code,0,error);const decoded=Buffer.concat(chunks);assert.equal(decoded.length,width*height*3);assert.ok(decoded[1]>150)
 console.log('PASS: silent slide starts RTMP and decodes correct dimensions and green pixels')
 await request('OUTPUT_ENGINE',{id,active:false});clearInterval(publish);publish=undefined
 let stopped=false;for(let i=0;i<30;i++){const r=await fetch(`http://127.0.0.1:${api}/v3/paths/get/cam`);if(!r.ok||!(await r.json()).ready){stopped=true;break}await new Promise(r=>setTimeout(r,100))}
 assert.ok(stopped,'RTMP publisher leaked after stop');console.log('PASS: stopping output releases RTMP publisher')
}finally{
 clearTimeout(timer);clearInterval(publish);producer?.destroy();probe?.kill();child.kill();server.kill()
 if(child.exitCode===null&&child.signalCode===null)await once(child,'exit');if(server.exitCode===null&&server.signalCode===null)await once(server,'exit')
 const target=path.resolve(root);if(!target.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(target).startsWith('freeshow-rtmp-output-test-'))throw Error('Unsafe cleanup')
 await fs.rm(target,{recursive:true,force:true})
}
