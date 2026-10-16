import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const run = promisify(execFile)
const cursorApi = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public struct CaptureTestPoint { public int X; public int Y; } public static class CaptureTestCursor { [DllImport("user32.dll")] public static extern bool GetCursorPos(out CaptureTestPoint point); [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); }';`
const browser=await chromium.connectOverCDP('http://127.0.0.1:9224')
const context=browser.contexts()[0]
let main
for(const page of context.pages()) if(await page.evaluate(()=>window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label)==='main')main=page
await main.waitForFunction(()=>window.api)
await main.waitForTimeout(3000)
const errors=[];main.on('pageerror',e=>errors.push(e.message))
const base=await main.evaluate(()=>performance.getEntriesByType('resource').map(e=>e.name).find(u=>u.endsWith('/src/frontend/stores.ts'))?.replace(/stores\.ts$/,'') || null)
if(base) await main.evaluate(async base=>{
    const stores=await import(base+'stores.ts')
    stores.popupData.set({active:{type:'screen'},trigger:device=>window.selectedNative=device})
    stores.activePopup.set('choose_media_input')
},base)
else {
    await main.getByText('Media',{exact:true}).first().click()
    await main.waitForTimeout(1000)
    await main.getByText('Inputs',{exact:true}).first().click()
    await main.getByText('Screens',{exact:true}).first().click()
}
await main.locator('[data-native-sources="screen"]').waitFor()
await main.locator('[data-native-sources="window"]').waitFor()
assert.equal(await main.getByText('Choose a screen or window…',{exact:true}).count(),0)
await main.locator('[data-native-sources] img').first().waitFor({timeout:45000})
await main.waitForFunction(()=>!document.body.innerText.includes('Loading previews…'),null,{timeout:60000})
await main.screenshot({path:'tauri-test-output/native-picker.png'})
console.log('PASS: native thumbnail picker', {screens:await main.locator('[data-native-sources="screen"] .source').count(),windows:await main.locator('[data-native-sources="window"] .source').count()})
if(base) {
    await main.locator('[data-native-sources="screen"] .source').first().click()
    assert.ok(await main.evaluate(()=>window.selectedNative?.type==='screen' && window.selectedNative.id.startsWith('native-screen-')))
    await main.evaluate(async base=>{const stores=await import(base+'stores.ts');stores.activePopup.set(null)},base)
} else await main.getByText('Shows',{exact:true}).first().click()
const config={id:'capture-probe',bounds:{x:100,y:100,width:640,height:360},boundsLocked:true,alwaysOnTop:true}
await main.evaluate(config=>window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'TOGGLE_OUTPUTS',data:{state:true,outputs:[config]}}}),config)
let fixture
for(let n=0;n<30;n++){for(const page of context.pages()){try{if(await page.evaluate(()=>window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label)==='output-capture-probe')fixture=page}catch{}}if(fixture)break;await main.waitForTimeout(300)}
await fixture.waitForFunction(()=>window.api)
await fixture.waitForTimeout(1000)
await main.evaluate(()=>window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'SET_VALUE',data:{id:'capture-probe',key:'name',value:'FreeShow native capture fixture'}}}))
await fixture.evaluate(()=>{document.body.innerHTML='<div style="position:fixed;inset:0;background:rgb(22,196,91);color:white;font:30px sans-serif;padding:25px;">Native capture test</div>';document.body.style.margin='0';document.body.style.cursor='crosshair'})
const source=await main.evaluate(async()=>{const sources=await window.__TAURI_INTERNALS__.invoke('native_sources');return sources.find(source=>source.name==='FreeShow native capture fixture')})
assert.ok(source)
const {stdout}=await run('powershell',['-NoProfile','-NonInteractive','-Command',cursorApi+'$point=New-Object CaptureTestPoint; [CaptureTestCursor]::GetCursorPos([ref]$point) | Out-Null; [CaptureTestCursor]::SetCursorPos(400,300) | Out-Null; @{x=$point.X;y=$point.Y} | ConvertTo-Json -Compress'])
const originalCursor=JSON.parse(stdout)
let captured
try { captured=await main.evaluate(async ({base,id})=>{
    const bytes=await window.__TAURI_INTERNALS__.invoke('native_thumbnail',{id})
    if(bytes.byteLength<100)throw Error('Native thumbnail missing')
    const stream=await navigator.mediaDevices.getUserMedia({video:{mandatory:{chromeMediaSource:'desktop',chromeMediaSourceId:id}}})
    window.nativeTestStream=stream
    const video=document.createElement('video');video.muted=true;video.srcObject=stream;await video.play();await new Promise(r=>setTimeout(r,300))
    const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight
    const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0)
    const pixels=ctx.getImageData(280,180,40,40).data
    let deviation=0
    for(let n=0;n<pixels.length;n+=4) deviation=Math.max(deviation,Math.abs(pixels[n]-22),Math.abs(pixels[n+1]-196),Math.abs(pixels[n+2]-91))
    return {width:video.videoWidth,height:video.videoHeight,pixel:[...ctx.getImageData(300,200,1,1).data],cursorRegionDeviation:deviation}
},{base,id:source.id}) } finally { await run('powershell',['-NoProfile','-NonInteractive','-Command',cursorApi+`[CaptureTestCursor]::SetCursorPos(${Number(originalCursor.x)},${Number(originalCursor.y)}) | Out-Null`]) }
assert.ok(captured.width>=600 && captured.height>=300)
assert.ok(Math.abs(captured.pixel[0]-22)<8 && Math.abs(captured.pixel[1]-196)<8 && Math.abs(captured.pixel[2]-91)<8)
console.log('PASS: actual native window frames become a video stream',captured)
assert.ok(captured.cursorRegionDeviation<8,'OS cursor must not appear in the captured window')
console.log('PASS: native capture omits the actual OS pointer over the test window')
const sinkConfig={id:'native-sink',bounds:{x:900,y:100,width:640,height:360},boundsLocked:true,alwaysOnTop:false}
await main.evaluate(config=>window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'TOGGLE_OUTPUTS',data:{state:true,outputs:[config]}}}),sinkConfig)
let sink
for(let n=0;n<30;n++){for(const page of context.pages()){try{if(await page.evaluate(()=>window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label)==='output-native-sink')sink=page}catch{}}if(sink)break;await main.waitForTimeout(300)}
await sink.waitForFunction(()=>window.api)
const outputPixel=await sink.evaluate(async id=>{
    const stream=await navigator.mediaDevices.getUserMedia({video:{mandatory:{chromeMediaSource:'desktop',chromeMediaSourceId:id}}})
    const video=document.createElement('video');video.muted=true;video.srcObject=stream;await video.play();await new Promise(r=>setTimeout(r,300))
    const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0)
    const pixel=[...ctx.getImageData(300,200,1,1).data]
    stream.getTracks().forEach(track=>track.stop());return pixel
},source.id)
assert.ok(Math.abs(outputPixel[1]-196)<8)
await main.evaluate(config=>window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'TOGGLE_OUTPUTS',data:{state:false,outputs:[config]}}}),sinkConfig)
console.log('PASS: output window receives the native capture through the existing media API')
await main.evaluate(()=>window.nativeTestStream.getTracks().forEach(track=>track.stop()))
await main.waitForTimeout(700)
const lifecycle=await main.evaluate(async id=>{
    const invoke=window.__TAURI_INTERNALS__.invoke
    await invoke('native_capture_start',{id,consumer:'a'});await invoke('native_capture_start',{id,consumer:'b'})
    await new Promise(r=>setTimeout(r,400))
    await invoke('native_capture_stop',{id,consumer:'a'})
    const frame=await invoke('native_capture_frame',{id,consumer:'b'})
    await invoke('native_capture_stop',{id,consumer:'b'})
    let ended=false;try{await invoke('native_capture_frame',{id,consumer:'b'})}catch(e){ended=String(e).includes('Capture ended')}
    return {bytes:frame.byteLength,ended}
},source.id)
assert.ok(lifecycle.bytes>1000 && lifecycle.ended)
console.log('PASS: shared native capture stops after the final subscriber',lifecycle)
await main.evaluate(config=>window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'TOGGLE_OUTPUTS',data:{state:false,outputs:[config]}}}),config)
assert.deepEqual(errors,[])
await browser.close()

