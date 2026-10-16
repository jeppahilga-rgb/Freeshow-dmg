import {chromium} from 'playwright'
import assert from 'node:assert/strict'
const b=await chromium.connectOverCDP('http://127.0.0.1:9224');const context=b.contexts()[0];let main
for(const p of context.pages())try{if(p.url().startsWith('http://127.0.0.1:3000') && await p.evaluate(()=>window.__TAURI_INTERNALS__?.metadata.currentWindow.label)==='main')main=p}catch{}
await main.evaluate(async()=>{window.editorWebsiteAction?.destroy();window.editorWebsiteBox?.remove();const {default:Website}=await import('/src/frontend/components/slide/views/Website.svelte');const stores=await import('/src/frontend/stores.ts');stores.activePopup.set(null);const box=document.createElement('div');box.className='outputPreview';box.style.cssText='position:fixed;left:100px;top:100px;width:400px;height:250px;z-index:99999';document.body.append(box);window.editorWebsiteBox=box;const component=new Website({target:box,props:{src:'https://eu.ugreen.com/pages/download',ratio:1}});window.editorWebsiteAction={destroy:()=>component.$destroy()}})
await main.waitForTimeout(800);let child
for(let n=0;n<30;n++){child=context.pages().find(p=>p!==main&&p.url().includes('eu.ugreen.com'));if(child)break;await main.waitForTimeout(500)}
assert.ok(child);await child.waitForFunction(()=>document.body?.innerText.includes('KM Center'),null,{timeout:60000})
const size=await child.evaluate(()=>({width:innerWidth,height:innerHeight}));assert.ok(size.width<=410&&size.height<=260)
await main.evaluate(()=>{window.editorWebsiteBox.classList.remove('outputPreview')})
await main.waitForTimeout(800);assert.ok(!context.pages().includes(child))
await main.evaluate(()=>{window.editorWebsiteAction.destroy();window.editorWebsiteBox.remove()})
console.log('PASS main output website preview stays bounded and closes when removed',size)
await b.close()






