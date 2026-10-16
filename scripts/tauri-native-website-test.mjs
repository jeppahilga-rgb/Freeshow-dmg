import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const browser=await chromium.connectOverCDP('http://127.0.0.1:9224')
const context=browser.contexts()[0];let main
for(const page of context.pages())try{if(await page.evaluate(()=>window.__TAURI_INTERNALS__?.metadata.currentWindow.label)==='main')main=page}catch{}
await main.waitForFunction(()=>window.api)
await main.evaluate(()=>window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'TOGGLE_OUTPUTS',data:{state:false,outputs:[{id:'website-probe'}]}}}))
await main.waitForTimeout(500)
const config={id:'website-probe',bounds:{x:100,y:100,width:1000,height:650},boundsLocked:true,alwaysOnTop:false}
await main.evaluate(config=>window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'TOGGLE_OUTPUTS',data:{state:true,outputs:[config]}}}),config)
let output
for(let n=0;n<40;n++){for(const page of context.pages())try{if(await page.evaluate(()=>window.__TAURI_INTERNALS__?.metadata.currentWindow.label)==='output-website-probe')output=page}catch{}if(output)break;await main.waitForTimeout(300)}
await output.waitForFunction(()=>window.api)
const base=await output.evaluate(()=>performance.getEntriesByType('resource').map(e=>e.name).find(u=>u.endsWith('/src/frontend/stores.ts'))?.replace(/stores\.ts$/,''))
if(base) await output.evaluate(async base=>{document.body.innerHTML='<div id="website-fixture" style="position:fixed;left:0;top:0;width:100%;height:100%;"></div>';const {attachPersistentWebview}=await import(base+'components/slide/views/websiteDomPool.ts');window.websiteAction=attachPersistentWebview(document.getElementById('website-fixture'),{src:'https://eu.ugreen.com/pages/download',isOutput:true,outputId:'website-probe'})},base)
else await output.evaluate(async()=>{
    const id='output-website-probe-website-'+crypto.randomUUID(),bounds={x:0,y:0,width:innerWidth,height:innerHeight}
    const invoke=window.__TAURI_INTERNALS__.invoke
    await invoke('website_view',{id,action:'show',url:'https://eu.ugreen.com/pages/download',bounds})
    window.websiteAction={update:options=>invoke('website_view',{id,action:'show',url:options.src,bounds}),destroy:()=>invoke('website_view',{id,action:'close'})}
})
let remote
for(let n=0;n<40;n++){remote=context.pages().find(page=>page.url().startsWith('https://eu.ugreen.com/'));if(remote)break;await main.waitForTimeout(300)}
assert.ok(remote,'Native UGREEN page created')
await remote.getByText('KM Center Download',{exact:true}).first().waitFor({timeout:45000})
assert.ok((await remote.locator('body').innerText()).includes('UGREEN'))
assert.ok(await remote.evaluate(async()=>{if(!window.__TAURI_INTERNALS__)return true;try{await window.__TAURI_INTERNALS__.invoke('read_store',{key:'SETTINGS'});return false}catch{return true}}))
console.log('PASS remote website cannot read FreeShow settings')
await remote.screenshot({path:'tauri-test-output/native-ugreen.png'})
console.log('PASS UGREEN native website rendered despite frame-ancestors none')
await output.evaluate(()=>window.websiteAction.update({src:'https://www.youtube.com/watch?v=lZiqgrtNT6s',isOutput:true,outputId:'website-probe'}))
let youtube
for(let n=0;n<60;n++){youtube=context.pages().find(page=>page.url().startsWith('https://www.youtube.com/watch'));if(youtube)break;await main.waitForTimeout(300)}
assert.ok(youtube)
await youtube.waitForFunction(()=>document.querySelector('video')?.videoWidth>0,null,{timeout:60000})
assert.ok((await youtube.title()).includes('YouTube'))
await youtube.screenshot({path:'tauri-test-output/native-youtube.png'})
console.log('PASS normal YouTube watch page rendered and video decoded')
await output.evaluate(()=>window.websiteAction.destroy())
await main.waitForTimeout(1000)
assert.equal(context.pages().filter(page=>page.url().startsWith('https://www.youtube.com/watch')).length,0)
console.log('PASS native website closed on item removal')
await main.evaluate(()=>window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'TOGGLE_OUTPUTS',data:{state:false,outputs:[{id:'website-probe'}]}}}))
await browser.close()
