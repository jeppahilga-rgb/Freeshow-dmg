import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import net from 'node:net'
const app=await chromium.connectOverCDP('http://127.0.0.1:9224');const main=app.contexts()[0].pages().find(p=>p.url().startsWith('http://127.0.0.1:3000'))
const base=await main.evaluate(()=>performance.getEntriesByType('resource').map(e=>e.name).find(u=>u.endsWith('/stores.ts')).replace(/stores.ts$/,''))
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try{
 await main.evaluate(async base=>{const stores=await import(base+'stores.ts');const get=store=>{let value;store.subscribe(v=>value=v)();return value};window.remoteOriginal={serverData:structuredClone(get(stores.serverData)),outputs:structuredClone(get(stores.outputs))};stores.serverData.set({remote:{password:'fixture-password'}});stores.outputs.set({'remote-probe':{id:'remote-probe',name:'Remote test',enabled:true,active:false,boundsLocked:true,bounds:{x:100,y:100,width:640,height:360},alwaysOnTop:false,out:{}}});stores.popupData.set({id:'remote',ip:'localhost'});stores.activePopup.set('connect')},base)
 await main.waitForFunction(()=>[...document.querySelectorAll('a')].some(a=>a.textContent.includes(':5510/?token=')),null,{timeout:15000})
 assert.ok(await main.locator('img').count()>0)
 const url=await main.evaluate(()=>[...document.querySelectorAll('a')].find(a=>a.textContent.includes(':5510/?token=')).textContent.trim())
 assert.ok(!url.includes('localhost'))
 const local=url.replace(/http:\/\/[^:]+:/,'http://127.0.0.1:')
 const context=await browser.newContext();await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());const phone=await context.newPage();await phone.goto(local)
 await phone.locator('#auth').waitFor({state:'visible'});await phone.locator('#password').fill('wrong');await phone.locator('#auth button').click();await phone.getByText('Incorrect password',{exact:true}).waitFor()
 assert.equal(await phone.locator('#controls').isVisible(),false)
 await phone.locator('#password').fill('fixture-password');await phone.locator('#auth button').click();await phone.locator('#shows button').first().waitFor({timeout:15000});const count=await phone.locator('#shows button').count();assert.ok(count>0)
 console.log('PASS LAN link/QR, offline page, wrong-password rejection, authenticated show list', {shows:count})
 await main.evaluate(async base=>{const stores=await import(base+'stores.ts');stores.activePopup.set(null);const get=store=>{let value;store.subscribe(v=>value=v)();return value};await window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'TOGGLE_OUTPUTS',data:{state:true,outputs:[get(stores.outputs)['remote-probe']]}}})},base)
 await phone.locator('#shows button').first().click();await phone.locator('#slides button').first().waitFor({timeout:15000});await phone.locator('#slides button').first().click()
 await main.waitForFunction(async base=>{const stores=await import(base+'stores.ts');const get=store=>{let value;store.subscribe(v=>value=v)();return value};return !!get(stores.outputs)['remote-probe']?.out?.slide?.id},base)
 console.log('PASS phone show/slide command updates actual presentation output')
 const bad=await context.request.get('http://127.0.0.1:5510/');assert.equal(bad.status(),403)
 const query=new URL(local).search;const client=await (await context.request.post('http://127.0.0.1:5510/connect'+query,{data:{}})).json();const endpoint='http://127.0.0.1:5510/message'+query+'&id='+client.id
 assert.equal((await context.request.post(endpoint,{data:null})).status(),400)
 assert.equal((await context.request.post(endpoint,{data:{channel:'API:delete_show'}})).status(),400)
 assert.equal((await context.request.post(endpoint,{data:'x'.repeat(70000)})).status(),413)
 const occupied=net.createServer();await new Promise(r=>occupied.listen(0,'0.0.0.0',r));const port=occupied.address().port
 const bindError=await main.evaluate(async port=>{try{await window.__TAURI_INTERNALS__.invoke('remote_start',{port});return ''}catch(e){return String(e)}},port);assert.match(bindError,/Cannot start remote/);await new Promise(r=>occupied.close(r));assert.equal((await context.request.get(local)).status(),200)
 console.log('PASS invalid/oversized commands rejected; failed port change preserves server')
 await main.evaluate(()=>window.__TAURI_INTERNALS__.invoke('remote_stop'))
 console.log('PASS unpaired link rejected and remote server stops')
}finally{
 await main.evaluate(async base=>{await window.__TAURI_INTERNALS__.invoke('remote_stop');await window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'TOGGLE_OUTPUTS',data:{state:false,outputs:[{id:'remote-probe'}]}}});const stores=await import(base+'stores.ts');stores.activePopup.set(null);if(window.remoteOriginal){stores.serverData.set(window.remoteOriginal.serverData);stores.outputs.set(window.remoteOriginal.outputs)}},base).catch(()=>{})
 await browser.close();await app.close()
}


