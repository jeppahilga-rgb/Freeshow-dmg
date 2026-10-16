import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const browser=await chromium.connectOverCDP('http://127.0.0.1:9224')
const context=browser.contexts()[0];let main
for(const page of context.pages()) if(await page.evaluate(()=>window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label)==='main')main=page
await main.waitForTimeout(5000)
const errors=[];main.on('pageerror',e=>errors.push(e.message))
await main.evaluate(()=>{window.localWebsite?.destroy();document.querySelectorAll('#local-html-test').forEach(node=>node.remove())})
const index=await main.evaluate(()=>window.__TAURI_INTERNALS__.invoke('show_index'))
assert.equal(Object.keys(index).length,65)
const [id,entry]=Object.entries(index).find(([,s])=>s.name==='2 Corinthians 5,17 - NIV')
const show=await main.evaluate(id=>window.__TAURI_INTERNALS__.invoke('read_show',{id}),id)
assert.equal(show.content[1].name,entry.name)
const base=await main.evaluate(()=>performance.getEntriesByType('resource').map(e=>e.name).find(u=>u.endsWith('/src/frontend/stores.ts')).replace(/stores\.ts$/,''))
await main.evaluate(async ({base,id,show})=>{
    const stores=await import(base+'stores.ts')
    stores.showsCache.update(cache=>({...cache,[id]:show}))
    stores.activeShow.set({id,type:'show'})
},{base,id,show:show.content[1]})
await main.waitForTimeout(1000)
assert.ok(await main.locator('body').innerText().then(text=>text.includes(entry.name)))
const local=await main.evaluate(async base=>{
    const {attachPersistentWebview}=await import(base+'components/slide/views/websiteDomPool.ts')
    const node=document.createElement('div');node.id='local-html-test';node.style.cssText='position:fixed;inset:50px;background:black;z-index:99999';document.body.appendChild(node)
    window.localWebsite=attachPersistentWebview(node,{src:'file:///G:/My%20Drive/Freeshow/HTML%20Slideshow/welcome.html'})
    return node.firstChild.src
},base)
const frame=main.frameLocator('#local-html-test iframe')
await frame.locator('body').waitFor({timeout:20000})
let text=''
for(let n=0;n<30;n++) {text=await frame.locator('body').innerText();if(text.length>20)break;await main.waitForTimeout(500)}
console.log('Local frame',local,text.slice(0,80))
assert.ok(text.length>20,'Local HTML must actually render content')
await main.screenshot({path:'tauri-test-output/drive-html.png'})
console.log('PASS: 65 copied shows loaded, real show opened, local HTML rendered', {url:local,characters:text.length,errors})
assert.deepEqual(errors,[])
await main.evaluate(()=>{window.localWebsite.destroy();document.getElementById('local-html-test').remove()})
const config=await main.evaluate(async base=>{const stores=await import(base+'stores.ts');let outputs;stores.outputs.subscribe(v=>outputs=v)();const id=Object.keys(outputs)[0];return {id,...outputs[id],screen:'1',boundsLocked:false,alwaysOnTop:false}},base)
const secondary={...config,id:'test-secondary',name:'Secondary',boundsLocked:true,bounds:{x:100,y:100,width:640,height:360}}
await main.evaluate(async ({base,secondary})=>{const stores=await import(base+'stores.ts');stores.outputs.update(outputs=>({...outputs,[secondary.id]:secondary}))},{base,secondary})
await main.evaluate(secondary=>window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'TOGGLE_OUTPUTS',data:{state:true,outputs:[secondary]}}}),secondary)
await main.evaluate(config=>window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'TOGGLE_OUTPUTS',data:{state:true,outputs:[config]}}}),config)
let output
for(let n=0;n<30;n++){for(const page of context.pages())if(await page.evaluate(()=>window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label)==='output-'+config.id)output=page;if(output)break;await main.waitForTimeout(300)}
assert.ok(output)
await output.waitForFunction(()=>window.api)
await output.waitForTimeout(3000)
await main.evaluate(async ({base,id,layout,outputId})=>{const {setOutput}=await import(base+'components/helpers/output.ts');setOutput('slide',{id,layout,index:0},false,outputId)},{base,id,layout:show.content[1].settings.activeLayout,outputId:config.id})
await output.waitForTimeout(2000)
await output.getByText(/Therefore, if anyone is in Christ/).first().waitFor({timeout:30000})
await output.screenshot({path:'tauri-test-output/drive-output.png'})
const dimensions=await output.evaluate(()=>({width:innerWidth,height:innerHeight}))
const displays=await main.evaluate(()=>window.__TAURI_INTERNALS__.invoke('window_action',{action:'GET_DISPLAYS'}))
assert.equal(dimensions.width,Math.round(displays[0].bounds.width));assert.equal(dimensions.height,Math.round(displays[0].bounds.height))
console.log('PASS: scripture rendered in monitor-sized output',dimensions)
const outputCount=await main.evaluate(async base=>{const stores=await import(base+'stores.ts');let outputs;stores.outputs.subscribe(v=>outputs=v)();return Object.keys(outputs).length},base)
assert.equal(outputCount,2,'Window messages must not clear the editor output configuration')
await main.evaluate(secondary=>window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'TOGGLE_OUTPUTS',data:{state:false,outputs:[secondary]}}}),secondary)
console.log('PASS: two output windows preserve the editor configuration')
const welcomeId=Object.entries(index).find(([,show])=>show.name==='Welcome')[0]
const welcome=await main.evaluate(id=>window.__TAURI_INTERNALS__.invoke('read_show',{id}),welcomeId)
await main.evaluate(async ({base,id,show,outputId})=>{const stores=await import(base+'stores.ts');stores.showsCache.update(cache=>({...cache,[id]:show}));const {setOutput}=await import(base+'components/helpers/output.ts');setOutput('slide',{id,layout:show.settings.activeLayout,index:0},false,outputId)},{base,id:welcomeId,show:welcome.content[1],outputId:config.id})
const website=output.frameLocator('iframe[title="Website output"]').first()
await website.locator('body').waitFor({timeout:20000})
let websiteText=''
for(let n=0;n<30;n++){websiteText=await website.locator('body').innerText();if(websiteText.length>20)break;await output.waitForTimeout(300)}
assert.ok(websiteText.length>20)
await output.waitForTimeout(2000)
await output.screenshot({path:'tauri-test-output/drive-website-output.png'})
console.log('PASS: original Welcome show renders its local website in the presentation window')
await main.evaluate(config=>window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'TOGGLE_OUTPUTS',data:{state:false,outputs:[config]}}}),config)
await browser.close()
