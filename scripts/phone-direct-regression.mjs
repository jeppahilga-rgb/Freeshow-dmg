import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import path from 'node:path'
const child=spawn(path.resolve('../.toolchains/flutter/bin/cache/dart-sdk/bin/dart.exe'),['run','test_support/direct_fixture.dart'],{cwd:'phone-app',windowsHide:true,stdio:['ignore','pipe','pipe']})
let browser,configuration
try {
  configuration=await new Promise((resolve,reject)=>{let buffer='';const timeout=setTimeout(()=>reject(Error('Dart fixture startup timeout')),30000);child.stdout.on('data',d=>{buffer+=d;const line=buffer.split('\n')[0];try{const value=JSON.parse(line);clearTimeout(timeout);resolve(value)}catch{}});child.on('exit',code=>reject(Error('Fixture exited '+code)));child.stderr.on('data',d=>process.stderr.write(d))})
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--host-resolver-rules=MAP direct-camera.test 127.0.0.1','--no-proxy-server']})
  const sender=await browser.newPage()
  await sender.exposeFunction('sendNative',async message=>{await fetch(configuration.controller+'/send',{method:'POST',body:JSON.stringify(message)})})
  await sender.goto('about:blank')
  await sender.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');window.timer=setInterval(()=>{ctx.fillStyle='#12bd45';ctx.fillRect(0,0,640,360)},33);window.stream=canvas.captureStream(30);window.peers=new Map()})
  const receiver=await browser.newPage()
  const address=new URL(configuration.receiver);address.hostname='direct-camera.test'
  await receiver.goto(address.href)
  if(await receiver.evaluate(()=>isSecureContext))throw Error('Must test an insecure HTTP origin')
  let done=false
  const relay=(async()=>{while(!done){for(const message of await (await fetch(configuration.controller+'/poll')).json()){await sender.evaluate(async m=>{const key=m.key;if(m.type==='request'){if(peers.has(key))return;const pc=new RTCPeerConnection({iceServers:[]});pc.pending=[];peers.set(key,pc);for(const track of stream.getTracks())pc.addTrack(track,stream);pc.onicecandidate=e=>{if(e.candidate)sendNative({key,type:'candidate',candidate:e.candidate.toJSON()})};await pc.setLocalDescription(await pc.createOffer());await sendNative({key,type:'offer',description:pc.localDescription})}else if(m.type==='answer'){const pc=peers.get(key);await pc.setRemoteDescription(m.description);for(const c of pc.pending)await pc.addIceCandidate(c);pc.pending=[]}else if(m.type==='candidate'){const pc=peers.get(key);if(pc.remoteDescription)await pc.addIceCandidate(m.candidate);else pc.pending.push(m.candidate)}else if(m.type==='close'){peers.get(key)?.close();peers.delete(key)}},message)}await new Promise(r=>setTimeout(r,50))}})()
  try {
    await receiver.waitForFunction(()=>document.querySelector('video').videoWidth===640,{},{timeout:30000})
    await receiver.waitForFunction(()=>{const video=document.querySelector('video'),canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0,1,1);return ctx.getImageData(0,0,1,1).data[1]>150},{},{timeout:15000})
    console.log('PASS: actual WebRTC video received on insecure HTTP origin without PC installation or camera permissions.')
    await receiver.close()
    await sender.waitForFunction(()=>peers.size===0,{},{timeout:5000})
    console.log('PASS: closing receiver releases its sender connection.')
  } finally {done=true;await relay}
} finally {
  await browser?.close()
  if(configuration)await fetch(configuration.controller+'/stop').catch(()=>{})
  child.kill()
}
