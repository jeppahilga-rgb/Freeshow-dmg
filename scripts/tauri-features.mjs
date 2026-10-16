import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const browser = await chromium.connectOverCDP('http://127.0.0.1:9224')
const context = browser.contexts()[0]
let main
for (const page of context.pages()) if (await page.evaluate(() => window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label) === 'main') main=page
await main.reload()
await main.waitForFunction(() => window.api)
const base = await main.evaluate(() => performance.getEntriesByType('resource').map(e=>e.name).find(u=>u.endsWith('/src/frontend/stores.ts')).replace(/stores\.ts$/, ''))
const results = await main.evaluate(async base => {
    const lyrics = await import(base+'tauri/lyrics.ts')
    const songs = await lyrics.searchLyrics({title:'Amazing Grace'})
    const song = songs[0] && await lyrics.getLyrics(songs[0])
    const camera = await import(base+'media/cameraManager.ts')
    const manager = camera.cameraManager
    const devices = await manager.getCamerasList(true)
    const stream = await manager.getCameraStream(devices[0]?.id || '')
    const live = typeof stream !== 'string' && stream.active
    if (live) stream.getTracks().forEach(t=>t.stop())
    const captureUrl = performance.getEntriesByType('resource').map(e=>e.name).filter(u=>new URL(u).pathname.endsWith('/tauri/screenCapture.ts')).at(-1)
    const capture = await import(captureUrl)
    window.featureCapture = capture
    const canvas = document.createElement('canvas'); canvas.width=320; canvas.height=180
    const ctx=canvas.getContext('2d')
    const timer=setInterval(()=>{ctx.fillStyle='#ff0000';ctx.fillRect(0,0,320,180)},50)
    window.featureCanvas={canvas,timer}
    const screen=capture.registerScreen(canvas.captureStream(15))
    return {songs:songs.length,lyricLength:song?.lyrics?.length,cameras:devices.length,live,screen:screen.id,displayAPI:typeof navigator.mediaDevices.getDisplayMedia}
},base)
console.log(results)
assert.ok(results.songs && results.lyricLength)
assert.ok(results.cameras && results.live)
await main.evaluate(() => window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'TOGGLE_OUTPUTS',data:{state:true,outputs:[{id:'feature',bounds:{x:100,y:100,width:640,height:360},screen:null,locked:true,alwaysOnTop:false}]}}}))
let output
for(let n=0;n<30;n++) { output=context.pages().find(p=>p!==main); if(output) break; await main.waitForTimeout(300) }
await output.waitForFunction(()=>window.api)
const relay=await output.evaluate(async id=>{
    const stream=await navigator.mediaDevices.getUserMedia({video:{mandatory:{chromeMediaSource:'desktop',chromeMediaSourceId:id}}})
    const video=document.createElement('video');video.muted=true;video.srcObject=stream;await video.play()
    await new Promise(r=>setTimeout(r,1000))
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180
    const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0)
    const pixel=[...ctx.getImageData(50,50,1,1).data]
    stream.getTracks().forEach(t=>t.stop())
    return {width:video.videoWidth,pixel}
},results.screen)
console.log('Screen relay',relay)
assert.equal(relay.width,320); assert.ok(relay.pixel[0]>200 && relay.pixel[1]<30)
const website = await main.evaluate(async base=>{
    const {attachPersistentWebview}=await import(base+'components/slide/views/websiteDomPool.ts')
    const node=document.createElement('div');document.body.appendChild(node)
    const action=attachPersistentWebview(node,{src:'https://example.com',zoom:100})
    await new Promise(r=>setTimeout(r,2000))
    const result={tag:node.firstChild.tagName,src:node.firstChild.src}
    action.destroy();node.remove();return result
},base)
assert.equal(website.tag,'IFRAME');console.log('Website',website)
await main.evaluate(async (args)=>{clearInterval(window.featureCanvas.timer); window.featureCapture.stopScreen(args.id);await window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'TOGGLE_OUTPUTS',data:{state:false,outputs:[{id:'feature'}]}}})},{base,id:results.screen})
await browser.close()
