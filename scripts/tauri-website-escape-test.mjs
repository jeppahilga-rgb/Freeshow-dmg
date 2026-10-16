import {chromium} from 'playwright'
import assert from 'node:assert/strict'
const b=await chromium.connectOverCDP('http://127.0.0.1:9224');const context=b.contexts()[0];let main
for(const p of context.pages())try{if(await p.evaluate(()=>window.__TAURI_INTERNALS__?.metadata.currentWindow.label)==='main')main=p}catch{}
const config={id:'escape-probe',bounds:{x:100,y:100,width:800,height:600},boundsLocked:true,alwaysOnTop:false}
await main.evaluate(config=>window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'TOGGLE_OUTPUTS',data:{state:true,outputs:[config]}}}),config)
let output
for(let n=0;n<40;n++){for(const p of context.pages())try{if(await p.evaluate(()=>window.__TAURI_INTERNALS__?.metadata.currentWindow.label)==='output-escape-probe')output=p}catch{}if(output)break;await main.waitForTimeout(300)}
await output.waitForFunction(()=>window.api)
await output.evaluate(()=>window.__TAURI_INTERNALS__.invoke('website_view',{id:'output-escape-probe-website-escape',action:'show',url:'https://eu.ugreen.com/pages/download',bounds:{x:0,y:0,width:800,height:600}}))
let remote
for(let n=0;n<40;n++){remote=context.pages().find(p=>p.url().includes('eu.ugreen.com'));if(remote)break;await main.waitForTimeout(300)}
await remote.waitForLoadState('domcontentloaded');await remote.keyboard.press('Escape');await main.waitForTimeout(1000)
assert.ok(!context.pages().includes(output));assert.ok(!context.pages().includes(remote))
console.log('PASS Escape while a native website is focused closes its output')
await b.close()
