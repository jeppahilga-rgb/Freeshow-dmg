import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import assert from 'node:assert/strict'
const root=await fs.mkdtemp(path.join(os.tmpdir(),'freeshow-whip-test-')),app=path.join(root,'app')
await fs.mkdir(app);await fs.mkdir(path.join(root,'Shows'))
await fs.writeFile(path.join(root,'boot.json'),JSON.stringify({libraryRoot:root,appData:app,paths:{userData:app,temp:root,documents:root,music:root,videos:root,pictures:root}}))
let mode='normal',deleted=0
const server=http.createServer(async(req,res)=>{
 assert.equal(req.headers.authorization,'Bearer regression-token')
 if(req.method==='DELETE'){deleted++;res.writeHead(204).end();return}
 let offer='';for await(const chunk of req)offer+=chunk
 assert.equal(offer,'v=0\r\n')
 res.writeHead(201,{'Content-Type':'application/sdp',Location:mode==='foreign'?'http://example.invalid/resource':'/resource'})
 res.end(mode==='large'?'x'.repeat(300*1024):'v=0\r\n')
})
server.listen(0,'127.0.0.1');await once(server,'listening')
const url=`http://127.0.0.1:${server.address().port}/whip`
const child=spawn(process.execPath,['src-tauri/backend-runtime/build/backend.cjs'],{env:{...process.env,FREESHOW_BACKEND_CONFIG:path.join(root,'boot.json')},windowsHide:true,stdio:['pipe','pipe','pipe']})
let buffer='',readyResolve;const ready=new Promise(resolve=>readyResolve=resolve),waiting=new Map()
const send=message=>child.stdin.write(JSON.stringify(message)+'\n')
child.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const message=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(message.type==='ready')readyResolve();if(message.type==='response')waiting.get(message.id)?.(message);if(message.type==='native')send({type:'native-reply',id:message.id,data:null})}})
child.stderr.on('data',chunk=>process.stderr.write(chunk))
async function request(operation,data){return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{waiting.delete(id);reject(Error(operation+' timed out'))},15000);waiting.set(id,message=>{clearTimeout(timer);waiting.delete(id);message.error?reject(Error(message.error)):resolve(message.data)});send({id,operation,data})})}
let timer
try{
 await Promise.race([ready,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Startup timeout')),15000))]);clearTimeout(timer)
 const id='whip-regression',output={id,webrtc:true,webrtcData:{streaming:true,url,token:'regression-token'}}
 await request('OUTPUT_ENGINE',{output,active:true})
 const answer=await request('WHIP_SIGNAL',{outputId:id,action:'post',url,sdp:'v=0\r\n'})
 assert.equal(answer.answerSdp,'v=0\r\n')
 await assert.rejects(request('WHIP_SIGNAL',{outputId:id,action:'delete',url:url+'/invalid'}),/Invalid WHIP resource/)
 await request('OUTPUT_ENGINE',{id,active:false})
 await request('WHIP_SIGNAL',{outputId:id,action:'delete',url:answer.resourceUrl})
 assert.equal(deleted,1)
 console.log('PASS: WHIP authenticated signaling and cleanup after output removal')
 await request('OUTPUT_ENGINE',{output,active:true})
 mode='foreign';await assert.rejects(request('WHIP_SIGNAL',{outputId:id,action:'post',url,sdp:'v=0\r\n'}),/configured server/)
 mode='large';await assert.rejects(request('WHIP_SIGNAL',{outputId:id,action:'post',url,sdp:'v=0\r\n'}),/too large/)
 console.log('PASS: foreign resource URLs and oversized SDP answers are rejected')
}finally{
 clearTimeout(timer);child.kill();if(child.exitCode===null)await once(child,'exit');server.closeAllConnections();await new Promise(resolve=>server.close(resolve))
 const target=path.resolve(root);if(!target.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(target).startsWith('freeshow-whip-test-'))throw Error('Unsafe cleanup')
 await fs.rm(target,{recursive:true,force:true})
}
