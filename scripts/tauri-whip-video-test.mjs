import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {chromium} from 'playwright'
import assert from 'node:assert/strict'
const root=await fs.mkdtemp(path.join(os.tmpdir(),'freeshow-whip-video-test-'))
async function port(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const value=s.address().port;await new Promise(r=>s.close(r));return value}
const web=await port(),api=await port(),ice=await port()
await fs.writeFile(path.join(root,'server.yml'),`logLevel: error\nrtmp: no\nrtsp: no\nhls: no\nsrt: no\nwebrtc: yes\nwebrtcAddress: 127.0.0.1:${web}\nwebrtcLocalUDPAddress: ''\nwebrtcLocalTCPAddress: 127.0.0.1:${ice}\nwebrtcIPsFromInterfaces: false\nwebrtcAdditionalHosts: [127.0.0.1]\nwebrtcICEServers2: []\napi: yes\napiAddress: 127.0.0.1:${api}\npaths:\n  cam:\n`)
const server=spawn(path.resolve('src-tauri/mediamtx/mediamtx.exe'),[path.join(root,'server.yml')],{windowsHide:true,stdio:['ignore','ignore','pipe']});server.stderr.on('data',d=>process.stderr.write(d))
const html=await fs.readFile('src-tauri/backend-runtime/whip-host.html','utf8')
const site=http.createServer((_req,res)=>res.end('<html><body></body></html>'));site.listen(0,'127.0.0.1');await once(site,'listening')
let browser,paint,audio,deleted=false
const testAudio=process.argv.includes('--audio')
try{
 for(let i=0;i<50;i++){try{if((await fetch(`http://127.0.0.1:${api}/v3/paths/list`)).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--autoplay-policy=no-user-gesture-required']})
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${site.address().port}`)
 await page.exposeFunction('signal',async({channel,data})=>{
  if(channel==='DO_WHIP_POST'){const r=await fetch(data.url,{method:'POST',headers:{'Content-Type':'application/sdp'},body:data.sdp});if(!r.ok)throw Error(await r.text());return {outputId:data.outputId,answerSdp:await r.text(),resourceUrl:new URL(r.headers.get('location'),data.url).toString()}}
  if(channel==='DO_WHIP_DELETE'){const r=await fetch(data.url,{method:'DELETE'});deleted=r.ok||r.status===404||r.status===410;return null}
 })
 await page.evaluate(async html=>{window.errors=[];window.addEventListener('message',async event=>{if(event.source!==window.host?.contentWindow||event.data?.kind!=='FREESHOW_WHIP_SIGNAL')return;const {channel,data}=event.data;if(channel==='WEBRTC_LOG'){if(data.type==='error')window.errors.push(data.message);return}try{const answer=await window.signal({channel,data});if(answer)host.contentWindow.postMessage({channel:'WHIP_POST_RESPONSE',data:answer},location.origin)}catch(e){window.errors.push(String(e))}});const frame=document.createElement('iframe');window.host=frame;frame.srcdoc=html;const loaded=new Promise(r=>frame.onload=r);document.body.append(frame);await loaded},html)
 await page.evaluate(url=>host.contentWindow.postMessage({channel:'START_WHIP',data:{outputId:'test',url,fps:10,bitrate:500}},location.origin),`http://127.0.0.1:${web}/cam/whip`)
 const paintFrame=()=>page.evaluate(()=>{const bytes=new Uint8Array(160*90*4);for(let i=0;i<bytes.length;i+=4){bytes[i+1]=200;bytes[i+3]=255}host.contentWindow.postMessage({channel:'WEBRTC_FRAME',data:{outputId:'test',size:{width:160,height:90},buffer:bytes}},location.origin)})
 await paintFrame();paint=setInterval(()=>paintFrame().catch(()=>{}),100)
 if(testAudio){await page.evaluate(()=>window.audioSample=0);audio=setInterval(()=>page.evaluate(()=>{const samples=new Int16Array(960);for(let n=0;n<samples.length;n++)samples[n]=Math.round(Math.sin(2*Math.PI*440*window.audioSample++/48000)*12000);host.contentWindow.postMessage({channel:'WEBRTC_AUDIO',data:{outputId:'test',sampleRate:48000,channelCount:1,buffer:new Uint8Array(samples.buffer)}},location.origin)}).catch(()=>{}),20)}
 let ready=false;for(let i=0;i<200;i++){const r=await fetch(`http://127.0.0.1:${api}/v3/paths/get/cam`);if(r.ok&&(await r.json()).ready){ready=true;break}await new Promise(r=>setTimeout(r,100))}
 assert.ok(ready,JSON.stringify(await page.evaluate(()=>window.errors)))
 const viewer=await browser.newPage();await viewer.goto(`http://127.0.0.1:${site.address().port}`)
 await viewer.exposeFunction('offer',async sdp=>{const r=await fetch(`http://127.0.0.1:${web}/cam/whep`,{method:'POST',headers:{'Content-Type':'application/sdp'},body:sdp});if(!r.ok)throw Error(await r.text());return r.text()})
 await viewer.evaluate(async testAudio=>{const pc=new RTCPeerConnection();window.pc=pc;const video=document.createElement('video');video.autoplay=true;video.muted=true;document.body.append(video);pc.ontrack=e=>video.srcObject=e.streams[0];pc.addTransceiver('video',{direction:'recvonly'});if(testAudio)pc.addTransceiver('audio',{direction:'recvonly'});await pc.setLocalDescription(await pc.createOffer());await new Promise(r=>{if(pc.iceGatheringState==='complete')return r();pc.onicegatheringstatechange=()=>{if(pc.iceGatheringState==='complete')r()}});await pc.setRemoteDescription({type:'answer',sdp:await window.offer(pc.localDescription.sdp)})},testAudio)
 await viewer.waitForFunction(()=>{const v=document.querySelector('video');if(v.videoWidth!==160||v.videoHeight!==90)return false;const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');ctx.drawImage(v,0,0,1,1);return ctx.getImageData(0,0,1,1).data[1]>150},null,{timeout:15000})
 console.log('PASS: original WHIP iframe publishes live green video at 160x90 through MediaMTX')
 if(testAudio){
  await viewer.evaluate(async()=>{const pc=window.pc;const audioTrack=pc.getReceivers().map(r=>r.track).find(t=>t.kind==='audio');if(!audioTrack)throw Error('No WHIP audio receiver');const ctx=new AudioContext();await ctx.resume();const analyser=ctx.createAnalyser();analyser.fftSize=2048;const source=ctx.createMediaStreamSource(new MediaStream([audioTrack]));source.connect(analyser);const gain=ctx.createGain();gain.gain.value=0;analyser.connect(gain);gain.connect(ctx.destination);window.audioAnalyser=analyser;window.audioContext=ctx})
  await viewer.waitForFunction(()=>{const a=window.audioAnalyser,data=new Float32Array(a.fftSize);a.getFloatTimeDomainData(data);const rms=Math.sqrt(data.reduce((sum,n)=>sum+n*n,0)/data.length);return rms>0.05&&rms<0.5},null,{timeout:15000})
  console.log('PASS: mono 440 Hz PCM is published and decoded with audible signal through WHIP/MediaMTX')
 }
 await page.evaluate(()=>host.contentWindow.postMessage({channel:'STOP_WHIP',data:{outputId:'test'}},location.origin))
 for(let i=0;i<30&&!deleted;i++)await new Promise(r=>setTimeout(r,100));assert.ok(deleted,'WHIP resource was not deleted');console.log('PASS: stopping WHIP deletes the server resource')
}finally{
 clearInterval(paint);clearInterval(audio);await browser?.close();site.closeAllConnections();await new Promise(r=>site.close(r));server.kill();if(server.exitCode===null&&server.signalCode===null)await once(server,'exit')
 const target=path.resolve(root);if(!target.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(target).startsWith('freeshow-whip-video-test-'))throw Error('Unsafe cleanup');await fs.rm(target,{recursive:true,force:true})
}
