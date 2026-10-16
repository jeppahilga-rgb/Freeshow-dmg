import {chromium} from 'playwright'
import assert from 'node:assert/strict'
const app=await chromium.connectOverCDP('http://127.0.0.1:9224');const main=app.contexts()[0].pages().find(p=>p.url().startsWith('http://tauri.localhost'))
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try{
 const info=await main.evaluate(()=>window.__TAURI_INTERNALS__.invoke('remote_start',{port:5510}))
 const password=await main.evaluate(async()=>{const s=await window.__TAURI_INTERNALS__.invoke('read_store',{key:'SETTINGS'});return s.serverData?.remote?.password||''})
 const url=info.urls.find(url=>url.includes('127.0.0.1'))
 const context=await browser.newContext();await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());const page=await context.newPage();await page.goto(url)
 await page.waitForFunction(()=>!document.getElementById('auth').hidden||!document.getElementById('controls').hidden)
 if(await page.locator('#auth').isVisible()){await page.locator('#password').fill(password);await page.locator('#auth button').click()}
 await page.locator('#controls').waitFor({state:'visible',timeout:15000})
 console.log('PASS packaged offline remote connects and loads library', {shows:await page.locator('#shows button').count(),lanAddress:info.urls.some(url=>!url.includes('127.0.0.1'))})
 assert.equal((await context.request.get('http://127.0.0.1:5510/')).status(),403)
}finally{await main.evaluate(()=>window.__TAURI_INTERNALS__.invoke('remote_stop')).catch(()=>{});await browser.close();await app.close()}
