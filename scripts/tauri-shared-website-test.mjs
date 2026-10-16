import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
const script=await fs.readFile('src-tauri/src/shared_website.js','utf8')
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try {
    const source=await browser.newPage({viewport:{width:1920,height:1080}})
    await source.addInitScript(()=>{window.fullscreenCalls=[];window.activityCalls=[];window.__TAURI_INTERNALS__={invoke:async(command,data)=>{(command==='website_source_activity'?window.activityCalls:window.fullscreenCalls).push({command,...data})}}})
    await source.addInitScript(script)
    await source.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<html><head></head><body><div id="player" style="width:600px;height:300px;background:#248"><video style="position:absolute;left:125px;top:70px;width:2560px;height:1440px;transform:translate(30px,20px)"></video><button id="expand" onclick="document.getElementById(\'player\').requestFullscreen()">Expand</button></div><input id="text"></body></html>'}))
    await source.goto('https://fixture.test/')
    await source.evaluate(async()=>{
        const pixels=document.createElement('canvas');pixels.width=640;pixels.height=360;
        const context=pixels.getContext('2d');context.fillStyle='#0044ee';context.fillRect(0,0,640,360);
        const video=document.querySelector('video');video.muted=true;video.srcObject=pixels.captureStream(10);
    })
    assert.equal(await source.locator('video').evaluate(video=>video.paused),true)
    await source.evaluate(()=>window.__freeshowInput({type:'play'}))
    await source.waitForFunction(()=>!document.querySelector('video').paused)
    await source.locator('video').evaluate(video=>video.pause())
    const r=await source.locator('#expand').boundingBox()
    await source.evaluate(point=>window.__freeshowInput({type:'click',x:point.x/1920,y:point.y/1080}),{x:r.x+r.width/2,y:r.y+r.height/2})
    await source.waitForFunction(()=>document.fullscreenElement?.id==='player')
    await source.waitForFunction(()=>!document.querySelector('video').paused)
    assert.deepEqual(await source.evaluate(()=>window.fullscreenCalls.at(-1)),{command:'website_source_fullscreen',expanded:true})
    await source.mouse.click(960,540)
    assert.equal(await source.locator('video').evaluate(video=>video.paused),true)
    await source.waitForFunction(()=>window.activityCalls.at(-1)?.paused===true)
    await source.mouse.click(960,540)
    await source.waitForFunction(()=>!document.querySelector('video').paused)
    await source.waitForFunction(()=>window.activityCalls.at(-1)?.paused===false)
    assert.deepEqual(await source.locator('#player').boundingBox(),{x:0,y:0,width:1920,height:1080})
    assert.deepEqual(await source.locator('video').boundingBox(),{x:0,y:0,width:1920,height:1080})
    await source.waitForFunction(()=>{
        const canvas=document.querySelector('[data-fs-video-mirror]');if(!canvas||canvas.width!==1920)return false;
        const pixel=canvas.getContext('2d').getImageData(960,540,1,1).data;
        return pixel[2]>200&&pixel[0]<20;
    })
    const frame=(await source.screenshot({type:'jpeg'})).toString('base64')
    const mirrors=[]
    for(let i=0;i<3;i++) {
        const page=await browser.newPage()
        await page.setContent('<canvas></canvas>')
        mirrors.push(await page.evaluate(async frame=>{const image=new Image();image.src='data:image/jpeg;base64,'+frame;await image.decode();const c=document.querySelector('canvas');c.width=image.width;c.height=image.height;c.getContext('2d').drawImage(image,0,0);return c.toDataURL()},frame))
    }
    assert(mirrors.every(image=>image===mirrors[0]))
    await source.evaluate(()=>window.__freeshowInput({type:'key',key:'Escape'}))
    await source.waitForFunction(()=>document.fullscreenElement===null)
    assert.equal(await source.locator('[data-fs-video-mirror]').count(),0)
    assert.equal(await source.locator('video').evaluate(video=>video.style.opacity),'')
    assert.deepEqual(await source.evaluate(()=>window.fullscreenCalls.at(-1)),{command:'website_source_fullscreen',expanded:false})
    const input=await source.locator('#text').boundingBox()
    await source.evaluate(point=>window.__freeshowInput({type:'click',x:point.x/1920,y:point.y/1080}),{x:input.x+5,y:input.y+5})
    await source.evaluate(()=>window.__freeshowInput({type:'key',key:'A'}))
    assert.equal(await source.locator('#text').inputValue(),'A')
    console.log(JSON.stringify({oneSource:true,identicalMirrors:3,fullResolution:[1920,1080],previewClickControl:true,expansion:true,escape:true,textInput:true}))
} finally {await browser.close()}
