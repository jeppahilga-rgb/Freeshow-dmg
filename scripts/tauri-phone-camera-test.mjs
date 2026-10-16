import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const app=await chromium.connectOverCDP('http://127.0.0.1:9224')
let main
for(const page of app.contexts()[0].pages())try{if(await page.evaluate(()=>window.__TAURI_INTERNALS__?.metadata.currentWindow.label)==='main')main=page}catch{}
await main.waitForFunction(()=>window.api)
const base=await main.evaluate(()=>performance.getEntriesByType('resource').map(e=>e.name).find(u=>u.endsWith('/src/frontend/stores.ts'))?.replace(/stores\.ts$/,''))
assert.ok(base,'Run against development build')
const camera=await main.evaluate(()=>window.__TAURI_INTERNALS__.invoke('phone_camera_start',{id:null}))
const local=camera.urls.find(url=>url.includes('127.0.0.1'))
const phoneBrowser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--ignore-certificate-errors']})
const context=await phoneBrowser.newContext({ignoreHTTPSErrors:true})
let blocked=0
await context.route('**/*',route=>{if(new URL(route.request().url()).hostname==='127.0.0.1')return route.continue();blocked++;return route.abort()})
await context.addInitScript(()=>{
    navigator.mediaDevices.getUserMedia=async()=>{
        const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360
        const ctx=canvas.getContext('2d');const draw=()=>{ctx.fillStyle='rgb(22,196,91)';ctx.fillRect(0,0,640,360)}
        draw();window.fixtureTimer=setInterval(draw,33)
        return canvas.captureStream(30)
    }
})
const phone=await context.newPage()
await phone.goto(local)
assert.equal((await context.request.get(local.replace(/token=[^&]+/,'token=invalid'))).status(),403)
assert.equal((await context.request.post(local.replace('/?','/signal?'),{data:'x'.repeat(70000)})).status(),413)
assert.ok((await context.request.get(local.replace('/?','/certificate.cer?'))).headers()['content-type'].includes('x509'))
console.log('PASS local pairing authentication, message size limit, and certificate download')
assert.ok(await phone.evaluate(()=>isSecureContext))
await phone.getByRole('button',{name:'Start camera',exact:true}).click()
await phone.getByText('Camera ready.',{exact:false}).waitFor()
await main.evaluate(({base,id})=>{window.phoneTestPromise=import(base+'media/cameraManager.ts').then(m=>m.cameraManager.getCameraStream(id))},{base,id:camera.id})
const pixels=await main.evaluate(async()=>{
    const stream=await window.phoneTestPromise
    if(typeof stream==='string')throw Error(stream)
    window.phoneTestStream=stream
    const video=document.createElement('video');video.muted=true;video.srcObject=stream;await video.play();await new Promise(resolve=>setTimeout(resolve,500))
    const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0)
    return {width:video.videoWidth,height:video.videoHeight,pixel:[...ctx.getImageData(300,200,1,1).data]}
})
assert.equal(pixels.width,640);assert.ok(Math.abs(pixels.pixel[1]-196)<8)
console.log('PASS offline local HTTPS phone sender -> actual camera manager',pixels)
assert.equal(blocked,0)
console.log('PASS phone page used only local requests, no external services')
const config={id:'phone-probe',bounds:{x:100,y:100,width:640,height:360},boundsLocked:true,alwaysOnTop:false}
await main.evaluate(config=>window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'TOGGLE_OUTPUTS',data:{state:true,outputs:[config]}}}),config)
let output
for(let n=0;n<40;n++){for(const page of app.contexts()[0].pages())try{if(await page.evaluate(()=>window.__TAURI_INTERNALS__?.metadata.currentWindow.label)==='output-phone-probe')output=page}catch{}if(output)break;await main.waitForTimeout(300)}
await output.waitForFunction(()=>window.api)
const outputBase=await output.evaluate(()=>performance.getEntriesByType('resource').map(e=>e.name).find(u=>u.endsWith('/src/frontend/stores.ts'))?.replace(/stores\.ts$/,''))
const outputPixel=await output.evaluate(async({base,id})=>{
    const {cameraManager}=await import(base+'media/cameraManager.ts');const stream=await cameraManager.getCameraStream(id);if(typeof stream==='string')throw Error(stream)
    const video=document.createElement('video');video.muted=true;video.srcObject=stream;await video.play();await new Promise(r=>setTimeout(r,500));
    const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0)
    return [...ctx.getImageData(300,200,1,1).data]
},{base:outputBase,id:camera.id})
assert.ok(Math.abs(outputPixel[1]-196)<8)
console.log('PASS second phone peer receives live frames in separate output')
await main.evaluate(()=>window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'TOGGLE_OUTPUTS',data:{state:false,outputs:[{id:'phone-probe'}]}}}))
await phone.screenshot({path:'tauri-test-output/offline-phone-page.png'})
await main.evaluate(async({base,id})=>{
    const stores=await import(base+'stores.ts');stores.special.update(s=>({...s,phoneCameras:[{id,name:'Phone camera test',group:''}]}))
    stores.popupData.set({active:{type:'camera'}});stores.activePopup.set('choose_media_input')
},{base,id:camera.id})
await main.getByRole('button',{name:'Connect phone camera',exact:true}).click()
await main.locator('.qr svg').waitFor()
assert.equal(await main.getByLabel('Phone camera link').inputValue(),camera.urls.find(url=>!url.includes('127.0.0.1'))||local)
await main.screenshot({path:'tauri-test-output/offline-phone-qr.png'})
console.log('PASS integrated QR setup and persisted phone camera entry')
await main.evaluate(async base=>{const stores=await import(base+'stores.ts');stores.activePopup.set(null);stores.special.update(s=>({...s,phoneCameras:[]}));window.phoneTestStream.getTracks().forEach(t=>t.stop())},base)
await phone.getByRole('button',{name:'Stop',exact:true}).click()
await phoneBrowser.close();await app.close()
