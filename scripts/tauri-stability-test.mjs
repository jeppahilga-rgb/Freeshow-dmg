import {chromium} from 'playwright'
import assert from 'node:assert/strict'
const browser=await chromium.connectOverCDP('http://127.0.0.1:9224');const context=browser.contexts()[0];let main
for(const p of context.pages())try{if(await p.evaluate(()=>window.__TAURI_INTERNALS__?.metadata.currentWindow.label)==='main')main=p}catch{}
await main.waitForFunction(()=>window.api,null,{timeout:60000})
await main.evaluate(()=>window.__TAURI_INTERNALS__.invoke('window_action',{action:'FULLSCREEN'}))
await main.keyboard.press('Escape')
await main.waitForFunction(async()=>!(await window.__TAURI_INTERNALS__.invoke('window_action',{action:'IS_FULLSCREEN'})))
console.log('PASS Escape exits main fullscreen')
const base=await main.evaluate(()=>performance.getEntriesByType('resource').map(e=>e.name).find(u=>u.includes('/media/cameraManager.ts')))
await main.evaluate(async base=>{
    window.mainCameraTestStream?.getTracks().forEach(track=>track.stop())
    window.savedGetUserMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);window.cameraOpenCount=0
    navigator.mediaDevices.getUserMedia=async()=>{window.cameraOpenCount++;const c=document.createElement('canvas');c.width=1920;c.height=1080;const ctx=c.getContext('2d');const draw=()=>{ctx.fillStyle='rgb(22,196,91)';ctx.fillRect(0,0,1920,1080);for(let x=0;x<1920;x+=8){ctx.fillStyle=x%16?'white':'black';ctx.fillRect(x,0,8,80)}};draw();window.cameraTestTimer=setInterval(draw,66);return c.captureStream(15)}
    const {cameraManager}=await import(base);window.mainCameraTestStream=await cameraManager.getCameraStream('fixture-camera')
},base)
const config={id:'relay-probe',bounds:{x:100,y:100,width:640,height:360},boundsLocked:true,alwaysOnTop:false}
await main.evaluate(config=>window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'TOGGLE_OUTPUTS',data:{state:true,outputs:[config]}}}),config)
let output
for(let n=0;n<40;n++){for(const p of context.pages())try{if(await p.evaluate(()=>window.__TAURI_INTERNALS__?.metadata.currentWindow.label)==='output-relay-probe')output=p}catch{}if(output)break;await main.waitForTimeout(300)}
await output.waitForFunction(()=>window.api)
await output.waitForTimeout(1000)
const outputBase=await output.evaluate(()=>performance.getEntriesByType('resource').map(e=>e.name).find(u=>u.includes('/media/cameraManager.ts')))
const pixel=await output.evaluate(async base=>{const {cameraManager}=await import(base);const stream=await cameraManager.getCameraStream('fixture-camera');if(typeof stream==='string')throw Error(stream);window.cameraTestStream=stream;const v=document.createElement('video');v.muted=true;v.srcObject=stream;await v.play();await new Promise(r=>setTimeout(r,400));const c=document.createElement('canvas');c.width=640;c.height=360;const ctx=c.getContext('2d');ctx.drawImage(v,0,0);return [...ctx.getImageData(300,200,1,1).data]},outputBase)
assert.ok(Math.abs(pixel[1]-196)<8)
const detail=await output.evaluate(async()=>{const v=document.createElement('video');v.muted=true;v.srcObject=window.cameraTestStream;await v.play();await new Promise(r=>setTimeout(r,1000));const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;const x=c.getContext('2d');x.drawImage(v,0,0);const row=x.getImageData(100,30,400,1).data;let edges=0;for(let n=4;n<row.length;n+=4)if(Math.abs(row[n]-row[n-4])>150)edges++;return{width:v.videoWidth,height:v.videoHeight,edges}})
assert.equal(detail.width,1920)
assert.equal(detail.height,1080)
assert.ok(detail.edges>=45,JSON.stringify(detail))
console.log('PASS camera relay preserves 1080p and eight-pixel detail',detail)
assert.equal(await main.evaluate(()=>window.cameraOpenCount),1)
console.log('PASS camera shared between editor and output with one device open')
await output.keyboard.press('Escape')
await main.waitForTimeout(800)
assert.ok(!context.pages().includes(output))
console.log('PASS Escape closes monitor-sized output')
await main.evaluate(async base=>{const {cameraManager}=await import(base);cameraManager.stopTracks(window.mainCameraTestStream,'fixture-camera');clearInterval(window.cameraTestTimer);navigator.mediaDevices.getUserMedia=window.savedGetUserMedia},base)
await browser.close()

