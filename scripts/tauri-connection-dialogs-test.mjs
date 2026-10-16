import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const browser=await chromium.connectOverCDP('http://127.0.0.1:9224')
let main
for(const page of browser.contexts()[0].pages())if(await page.evaluate(()=>window.__TAURI_INTERNALS__?.metadata.currentWindow.label)==='main')main=page
const base=await main.evaluate(()=>performance.getEntriesByType('resource').map(e=>e.name).find(u=>u.endsWith('/stores.ts')).replace(/stores.ts$/,''))
try{
    await main.evaluate(async base=>{const s=await import(base+'stores.ts');let ports;s.ports.subscribe(v=>ports=v)();window.dialogPorts=ports;s.ports.set({remote:15510,stage:15511,controller:15512,output_stream:15513,companion:15505})},base)
    for(const [id,port]of Object.entries({remote:15510,stage:15511,controller:15512,output_stream:15513,companion:15505})){
        await main.evaluate(async({base,id})=>{const s=await import(base+'stores.ts');s.popupData.set({id,ip:'localhost'});s.activePopup.set('connect')},{base,id})
        if(id==='companion')await main.getByText(/Socket.IO: ws:\/\/\d+\.\d+\.\d+\.\d+:15505/).waitFor()
        else{
            await main.waitForFunction(port=>[...document.querySelectorAll('a')].some(a=>new RegExp(`http://\\d+\\.\\d+\\.\\d+\\.\\d+:${port}/\\?token=`).test(a.textContent)),port)
            assert.ok(await main.locator('.popup img').count()>0 || await main.locator('img').count()>0)
        }
        assert.equal(await main.getByText(/Could not get the IP-address/).count(),0)
        await main.evaluate(async base=>{const s=await import(base+'stores.ts');s.activePopup.set(null)},base)
        await main.waitForTimeout(300)
        await main.evaluate(id=>window.__TAURI_INTERNALS__.invoke('local_server_stop',{kind:id}),id)
    }
    console.log('PASS all five Connect dialogs show LAN addresses; four browser connections show QR links')
}finally{
    await main.evaluate(async base=>{const s=await import(base+'stores.ts');s.activePopup.set(null);if(window.dialogPorts)s.ports.set(window.dialogPorts)},base).catch(()=>{})
    await browser.close()
}
