import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
const script=await fs.readFile('src-tauri/src/website_follow.js','utf8')
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try {
    const context=await browser.newContext()
    await context.route('**/*', route=>route.fulfill({contentType:'text/html',body:`<html><head></head><body style="height:3000px"><div id="player" style="width:600px;height:300px"><video></video><button id="expand" onclick="document.getElementById('player').requestFullscreen()">Expand</button></div><button id="details" onclick="document.getElementById('detail').hidden=false">Details</button><p id="detail" hidden>Open</p></body></html>`}))
    const source=await context.newPage(), target=await context.newPage()
    const reports=[]
    await source.exposeFunction('relay',async data=>{reports.push(data);await target.evaluate(data=>window.__freeshowFollow?.(data),data)})
    for(const page of [source,target]) {
        await page.addInitScript(script)
        await page.addInitScript(()=>{
            window.__TAURI_INTERNALS__={invoke:(_,args)=>window.relay?window.relay(args.data):Promise.resolve()}
            document.addEventListener('DOMContentLoaded',()=>{
                const video=document.querySelector('video');let time=0,paused=true,rate=1
                Object.defineProperties(video,{currentTime:{get:()=>time,set:v=>time=v},paused:{get:()=>paused},playbackRate:{get:()=>rate,set:v=>rate=v},readyState:{get:()=>4}})
                video.play=()=>{paused=false;return Promise.resolve()};video.pause=()=>{paused=true}
            })
        })
        await page.goto('https://fixture.test/')
    }
    for(const page of [source,target]) await page.evaluate(()=>{
        const watch=document.createElement('ytd-watch-flexy');
        watch.innerHTML='<div class="html5-video-player"><button class="ytp-size-button">Theater</button></div>';
        watch.querySelector('button').onclick=()=>watch.toggleAttribute('theater');
        document.body.prepend(watch);
    })
    await source.locator('.ytp-size-button').click()
    await target.waitForFunction(()=>document.querySelector('ytd-watch-flexy').hasAttribute('theater'))
    await source.locator('.ytp-size-button').click()
    await target.waitForFunction(()=>!document.querySelector('ytd-watch-flexy').hasAttribute('theater'))
    await source.locator('#details').click()
    await target.locator('#detail').waitFor({state:'visible'})
    await source.locator('#expand').click()
    await target.waitForFunction(()=>document.fullscreenElement?.id==='player')
    const box=await target.locator('#player').boundingBox()
    assert.equal(box.width,1280);assert.equal(box.height,720)
    await source.evaluate(()=>{const v=document.querySelector('video');v.currentTime=42;v.playbackRate=1.25;v.play()})
    await target.waitForFunction(()=>{const v=document.querySelector('video');return v.currentTime===42&&!v.paused&&v.playbackRate===1.25})
    await source.evaluate(()=>document.querySelector('video').pause())
    await target.waitForFunction(()=>document.querySelector('video').paused)
    await source.keyboard.press('Escape')
    await target.waitForFunction(()=>document.fullscreenElement===null)
    await source.evaluate(()=>scrollTo(0,500))
    await target.waitForFunction(()=>scrollY===500)
    assert(reports.length>0)
    console.log(JSON.stringify({theaterFollow:true,detailsFollow:true,expansionFollow:true,seekFollow:true,playPauseFollow:true,rateFollow:true,escapeFollow:true,scrollFollow:true}))
} finally {await browser.close()}
