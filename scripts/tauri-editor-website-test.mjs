import {chromium} from 'playwright'
import assert from 'node:assert/strict'
const b=await chromium.connectOverCDP('http://127.0.0.1:9224');const context=b.contexts()[0];let main
for(const p of context.pages())try{if(await p.evaluate(()=>window.__TAURI_INTERNALS__?.metadata.currentWindow.label)==='main')main=p}catch{}
await main.evaluate(async()=>{const {attachPersistentWebview}=await import('/src/frontend/components/slide/views/websiteDomPool.ts');const stores=await import('/src/frontend/stores.ts');stores.activePopup.set(null);const box=document.createElement('div');box.className='editItem selected';box.style.cssText='position:fixed;left:100px;top:100px;width:400px;height:250px;z-index:99999';document.body.append(box);window.editorWebsiteBox=box;window.editorWebsiteAction=attachPersistentWebview(box,{src:'https://eu.ugreen.com/pages/download',isOutput:false})})
let child
for(let n=0;n<30;n++){child=context.pages().find(p=>p!==main&&p.url().includes('eu.ugreen.com'));if(child)break;await main.waitForTimeout(500)}
assert.ok(child);await child.waitForFunction(()=>document.body.innerText.includes('KM Center'),null,{timeout:60000})
const size=await child.evaluate(()=>({width:innerWidth,height:innerHeight}));assert.ok(size.width<=410&&size.height<=260)
await main.evaluate(()=>{window.editorWebsiteBox.classList.remove('selected')})
await main.waitForTimeout(800);assert.ok(!context.pages().includes(child))
await main.evaluate(()=>{window.editorWebsiteAction.destroy();window.editorWebsiteBox.remove()})
console.log('PASS selected editor website stays within item bounds and closes on deselection',size)
await b.close()
