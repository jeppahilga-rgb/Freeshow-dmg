import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const app=await chromium.connectOverCDP('http://127.0.0.1:9224');let main
for(const p of app.contexts()[0].pages())try{if(await p.evaluate(()=>window.__TAURI_INTERNALS__?.metadata.currentWindow.label)==='main')main=p}catch{}
await main.waitForFunction(()=>window.api)
await main.evaluate(()=>window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'TOGGLE_OUTPUTS',data:{state:false,outputs:[{id:'offline-output-probe'}]}}}))
await main.waitForTimeout(500)
const camera=await main.evaluate(()=>window.__TAURI_INTERNALS__.invoke('phone_camera_start',{id:null}))
const local=camera.urls.find(url=>url.includes('127.0.0.1'))
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--ignore-certificate-errors']})
const context=await browser.newContext({ignoreHTTPSErrors:true})
await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
await context.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{const c=document.createElement('canvas');c.width=640;c.height=360;const ctx=c.getContext('2d');const paint=()=>{ctx.fillStyle='rgb(22,196,91)';ctx.fillRect(0,0,640,360)};paint();setInterval(paint,33);return c.captureStream(30)}})
const phone=await context.newPage();await phone.goto(local);await phone.getByRole('button',{name:'Start camera',exact:true}).click()
const config={id:'offline-output-probe',name:'Offline phone output test',enabled:true,bounds:{x:100,y:100,width:640,height:360},boundsLocked:true,alwaysOnTop:false,out:{background:{id:camera.id,name:'Phone test',type:'camera'}}}
await main.evaluate(config=>window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'TOGGLE_OUTPUTS',data:{state:true,outputs:[config]}}}),config)
let output
for(let n=0;n<40;n++){for(const p of app.contexts()[0].pages())try{if(await p.evaluate(()=>window.__TAURI_INTERNALS__?.metadata.currentWindow.label)==='output-offline-output-probe')output=p}catch{}if(output)break;await main.waitForTimeout(300)}
await output.waitForFunction(()=>window.api)
await output.waitForTimeout(3000)
await main.evaluate(config=>window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'OUTPUTS',data:{[config.id]:config}}}),config)
await output.waitForFunction(()=>[...document.querySelectorAll('video')].some(v=>v.videoWidth===640),null,{timeout:45000})
const pixel=await output.evaluate(()=>{const v=[...document.querySelectorAll('video')].find(v=>v.videoWidth===640);const c=document.createElement('canvas');c.width=640;c.height=360;const ctx=c.getContext('2d');ctx.drawImage(v,0,0);return [...ctx.getImageData(300,200,1,1).data]})
assert.ok(Math.abs(pixel[1]-196)<8)
await output.screenshot({path:'tauri-test-output/offline-phone-actual-output.png'})
console.log('PASS actual FreeShow output camera component renders local phone WebRTC video',pixel)
await main.evaluate(config=>window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'TOGGLE_OUTPUTS',data:{state:false,outputs:[config]}}}),config)
await browser.close();await app.close()
