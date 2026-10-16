import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
const renderer = await fs.readFile('src/frontend/tauri/sharedWebsite.ts', 'utf8')
const website = await fs.readFile('src/frontend/components/slide/views/Website.svelte', 'utf8')
const canvasStyle = renderer.match(/canvas\.style\.cssText="([^"]+)"/)[1]
const css = website.match(/<style>([\s\S]*?)<\/style>/)[1]
const browser = await chromium.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true })
try {
    const page = await browser.newPage()
    assert(renderer.includes('canvas.onclick=()=>{}'))
    const buttonStyle=renderer.match(/controlButton\.style\.cssText=`([^`]+)`/)[1].replace(/\$\{[^}]+\}/g,'1')
    await page.setContent(`<style>${css}</style><div id="slide" style="position:relative;width:320px;height:180px"><div class="website"><div class="webview-container"><canvas style="${canvasStyle}"></canvas><button style="${buttonStyle}">Website controls</button></div></div></div>`)
    await page.evaluate(() => {
        window.controls=0; window.enlarged=0
        document.querySelector('canvas').onclick=()=>{}
        document.querySelector('button').onclick=e=>{e.preventDefault();e.stopPropagation();window.controls++}
        document.querySelector('#slide').onclick=()=>window.enlarged++
    })
    await page.mouse.click(160,90)
    assert.deepEqual(await page.evaluate(()=>({controls:window.controls,enlarged:window.enlarged})),{controls:0,enlarged:1})
    await page.locator('button').click()
    assert.deepEqual(await page.evaluate(()=>({controls:window.controls,enlarged:window.enlarged})),{controls:1,enlarged:1})
    console.log('Real browser hit test passed: slide click reaches its handler; control button opens controls independently.')
} finally { await browser.close() }
