import {chromium} from 'playwright'
import {transform} from 'esbuild'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
const source=(await fs.readFile('src/frontend/tauri/outputSafety.ts','utf8')).replace('export function','function')+'\nwindow.fixtureInstall=installOutputEscapeHandlers'
const {code}=await transform(source,{loader:'ts',format:'iife'})
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try {
 const page=await browser.newPage();await page.setContent('<div id="video" style="width:400px;height:300px">Output</div>');await page.addScriptTag({content:code})
 await page.evaluate(()=>{window.exits=0;window.lowerHandlers=0;window.fixtureInstall(window,'output-center',async()=>{window.exits++});document.querySelector('#video').addEventListener('dblclick',()=>window.lowerHandlers++)})
 await page.locator('#video').dblclick();await page.keyboard.press('Escape')
 const result=await page.evaluate(()=>({exits:window.exits,lowerHandlers:window.lowerHandlers}))
 assert.deepEqual(result,{exits:2,lowerHandlers:0});console.log('PASS real double-click and Escape reach recovery before output media handlers',result)
}finally{await browser.close()}
