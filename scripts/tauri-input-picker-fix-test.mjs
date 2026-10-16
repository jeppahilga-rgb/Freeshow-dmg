import fs from 'node:fs/promises'
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try {
 const page=await browser.newPage();const calls=[];let failNdi=true
 await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:3000')?r.continue():r.abort())
 await page.exposeFunction('fixtureInvoke',async(c,a)=>{if(c==='backend_service'&&a.operation==='MEDIA_CHANNEL'){if(a.data.channel==='NDI'&&failNdi){failNdi=false;throw Error('NDI fixture runtime unavailable')}return []}if(c==='native_capture_browser'){calls.push(a);return null}if(c.startsWith('plugin:event|'))return 1;if(c==='read_store'||c==='show_index')return {};if(c==='native_sources'||c==='network_ips'||c==='media_files')return [];if(c==='window_action'&&a.action==='GET_DISPLAYS')return [];if(c==='app_info')return {VERSION:'fixture',IS_DEV:true,GET_OS:{platform:'win32'},DATA_PATH:'C:/Fixture',GET_CACHE_PATH:'C:/Fixture/cache',DEVICE_ID:'fixture'}[a.key];return null})
 await page.addInitScript(()=>{performance.setResourceTimingBufferSize(20000);let next=1;window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},invoke:(c,a)=>window.fixtureInvoke(c,a),transformCallback:()=>next++,unregisterCallback:()=>{},convertFileSrc:f=>f};window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}}})
 await page.goto('http://127.0.0.1:3000',{waitUntil:'domcontentloaded',timeout:120000});await page.waitForFunction(()=>window.api);await page.waitForTimeout(3000);await page.waitForFunction(()=>performance.getEntriesByType('resource').some(e=>new URL(e.name).pathname.endsWith('/stores.ts')) && !!document.querySelector('h1'),{},{timeout:120000})
 const stores=await page.evaluate(()=>performance.getEntriesByType('resource').map(e=>e.name).filter(u=>new URL(u).pathname.endsWith('/stores.ts')).at(-1))
 await page.evaluate(async url=>{const s=await import(url);s.popupData.set({active:{type:'screen'},trigger:()=>{}});s.activePopup.set('choose_media_input')},stores)
 const section=page.locator('[data-native-sources="window"]');await section.waitFor()
 await section.getByRole('textbox',{name:'Capture website address'}).fill('https://www.youtube.com/watch?v=test&x=1')
 await section.getByRole('button',{name:'Open capture browser',exact:true}).click()
 await section.getByRole('status').waitFor();assert.equal(calls[0].url,'https://www.youtube.com/watch?v=test&x=1')
 for(const name of ['NDI','OMT','Blackmagic']){const button=page.getByRole('button',{name,exact:true});assert.equal(await button.isDisabled(),false);await button.click();if(name==='NDI'){await page.getByRole('alert').waitFor();await page.getByRole('button',{name:'Retry discovery'}).click()}await page.getByText('Checking available sources…',{exact:true}).waitFor({state:'hidden'});assert.equal(await page.getByText('NDI, OMT and Blackmagic inputs are not available in this build.',{exact:true}).count(),0)};await fs.writeFile('../output/audit-fixes-input-picker.json',JSON.stringify({enabled:['NDI','OMT','Blackmagic'],errorRetry:true,discovery:true},null,2));console.log('PASS enabled input tabs, native discovery, error and retry');await page.setViewportSize({width:960,height:640});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
 console.log('PASS: capture browser URL dispatch, playback/refresh instructions and narrow layout')
}finally{await browser.close()}
