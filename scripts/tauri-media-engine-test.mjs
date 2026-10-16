import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
import net from 'node:net'
import {once} from 'node:events'
import {WebSocket} from 'ws'
const kind=process.argv[2]||'OMT';if(!['OMT','NDI'].includes(kind))throw Error('Use OMT or NDI');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'freeshow-media-test-')),app=path.join(root,'app');await fs.mkdir(app);await fs.mkdir(path.join(root,'Shows'))
await fs.writeFile(path.join(root,'boot.json'),JSON.stringify({libraryRoot:root,appData:app,paths:{userData:app,temp:root,documents:root,music:root,videos:root,pictures:root}}))
const child=spawn(process.env.FREESHOW_TEST_NODE||process.execPath,[process.env.FREESHOW_TEST_BACKEND||'src-tauri/backend-runtime/build/backend.cjs'],{env:{...process.env,FREESHOW_BACKEND_CONFIG:path.join(root,'boot.json')},windowsHide:true,stdio:['pipe','pipe','pipe']})
let buffer='',readyResolve;const ready=new Promise(resolve=>readyResolve=resolve),waiting=new Map();const send=message=>child.stdin.write(JSON.stringify(message)+'\n');child.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);const message=JSON.parse(line);if(message.type==='ready')readyResolve();if(message.type==='response')waiting.get(message.id)?.(message);if(message.type==='native')send({type:'native-reply',id:message.id,data:null})}});child.stderr.on('data',chunk=>process.stderr.write(chunk))
async function request(operation,data){return await new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{waiting.delete(id);reject(Error(operation+' timed out'))},30000);waiting.set(id,message=>{clearTimeout(timer);waiting.delete(id);message.error?reject(Error(message.error)):resolve(message.data)});send({id,operation,data})})}
const sockets=[];let timer,producer
try{
 await Promise.race([ready,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Startup timeout')),15000))]);clearTimeout(timer)
 const suffix=crypto.randomUUID().slice(0,8),id='engine-test-'+suffix,name='FreeShow regression '+suffix
 const engine=await request('OUTPUT_ENGINE',{output:{id,name,[kind.toLowerCase()]:true,[kind.toLowerCase()+'Data']:{name,framerate:10}},active:true})
 producer=net.connect(engine.port,'127.0.0.1');sockets.push(producer);await once(producer,'connect');const packet=bytes=>{const header=Buffer.alloc(4);header.writeUInt32LE(bytes.length);producer.write(Buffer.concat([header,bytes]))};packet(Buffer.from(JSON.stringify({id,token:engine.token})))
 const width=64,height=36,pixels=Buffer.alloc(width*height*4);for(let i=0;i<pixels.length;i+=4){pixels[i]=32;pixels[i+1]=128;pixels[i+2]=224;pixels[i+3]=255}const header=Buffer.alloc(8);header.writeUInt32LE(width);header.writeUInt32LE(height,4);const frame=Buffer.concat([header,pixels]);const publish=setInterval(()=>packet(frame),100)
 try{
  let source;const deadline=Date.now()+18000;while(Date.now()<deadline&&!source){const list=await request('MEDIA_CHANNEL',{channel:kind,message:{channel:'RECEIVE_LIST'}});source=list.find(item=>item.name.includes(name));if(!source)await new Promise(resolve=>setTimeout(resolve,500))}if(!source)throw Error('OMT output was not discoverable');console.log('PASS: original '+kind+' worker creates a discoverable sender')
  const connection=await request('MEDIA_TRANSPORT',{target:id}),websocket=new WebSocket(connection.url,{origin:'http://tauri.localhost'});sockets.push(websocket);await once(websocket,'open')
  const received=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('No decoded OMT frame')),12000);websocket.on('message',(data,binary)=>{if(!binary)return;const bytes=Buffer.from(data),length=bytes.readUInt32LE(),metadata=JSON.parse(bytes.subarray(4,4+length).toString());websocket.send('1');if(metadata.ipcChannel!==kind)return;clearTimeout(timeout);resolve({metadata,pixels:bytes.subarray(4+length)})})})
  await request('MEDIA_CHANNEL',{channel:kind,message:{channel:'CAPTURE_STREAM',data:{source:{...source,id:source.urlAddress},outputId:id}}})
  const receivedFrame=await received;console.log('Decoded dimensions',receivedFrame.metadata.args.data.frame.xres,receivedFrame.metadata.args.data.frame.yres,receivedFrame.pixels.length);if(receivedFrame.metadata.args.data.frame.xres!==width||receivedFrame.metadata.args.data.frame.yres!==height||receivedFrame.pixels.length<width*height*2)throw Error('Wrong decoded dimensions');console.log('PASS: raw frames reach the original '+kind+' decoder and binary renderer transport')
  websocket.removeAllListeners('message')
  await Promise.race([once(websocket,'message'),new Promise((_,reject)=>setTimeout(()=>reject(Error('No frame before reconnect')),5000))])
  websocket.terminate();await new Promise(resolve=>setTimeout(resolve,100))
  const replacement=new WebSocket(connection.url,{origin:'http://tauri.localhost'});sockets.push(replacement)
  const resumed=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Receiver stalled after unacknowledged disconnect')),8000);replacement.once('message',()=>{clearTimeout(timeout);replacement.send('1');resolve()})})
  await resumed;console.log('PASS: renderer reconnect resumes after a frame was left unacknowledged')
  await request('MEDIA_CHANNEL',{channel:kind,message:{channel:'CAPTURE_DESTROY',data:null}});await request('OUTPUT_ENGINE',{id,active:false});console.log('PASS: sender and receiver stop')
 }finally{clearInterval(publish)}
}finally{clearTimeout(timer);for(const socket of sockets){if(socket instanceof WebSocket)socket.terminate();else socket.destroy()}child.kill();if(child.exitCode===null)await once(child,'exit');const target=path.resolve(root);if(!target.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(target).startsWith('freeshow-media-test-'))throw Error('Unsafe cleanup');await fs.rm(target,{recursive:true,force:true})}
