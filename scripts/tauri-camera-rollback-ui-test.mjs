import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try {
 const page=await browser.newPage()
 await page.route('**/reaudit-state',r=>r.fulfill({contentType:'text/html',body:'<div id="fixture"></div>'}))
 await page.addInitScript(()=>{
  window.auditCalls=[];window.api={send(){},receive(){},removeListener(){}}
  window.__TAURI_INTERNALS__={invoke:async(command,args)=>{window.auditCalls.push({command,args});if(command==='virtual_camera'){if(args.action==='start')throw Error('Install camera component first');return {running:false,output:null}}if(command==='output_message')return;throw Error('Unexpected fixture command')}}
 })
 await page.goto('http://127.0.0.1:3000/reaudit-state')
 await page.evaluate(async()=>{const stores=await import('/src/frontend/stores.ts');const {default:Component}=await import('/src/frontend/components/settings/tabs/VirtualCameraOutput.svelte');window.auditStores=stores;window.auditBefore={enabled:true,name:'Physical center',screen:'1',virtualCamera:false,alwaysOnTop:true,bounds:{x:0,y:0,width:1920,height:1080}};stores.outputs.set({center:structuredClone(window.auditBefore)});stores.outputState.set([{id:"center",active:true}]);window.fixtureComponent=new Component({target:document.querySelector('#fixture'),props:{outputId:'center',enabled:true}})})
 await page.getByRole('button',{name:'Start virtual camera'}).click();await page.getByRole('alert').waitFor()
 const result=await page.evaluate(async()=>{let after;const unsubscribe=window.auditStores.outputs.subscribe(v=>after=v.center);unsubscribe();const calls=window.auditCalls.filter(c=>c.command==='output_message');return {before:window.auditBefore,after,error:document.querySelector('[role="alert"]').textContent,outputMessages:calls.map(c=>c.args.msg),cameraRunning:false}})
 assert.deepEqual(result.after,result.before);assert.equal(result.outputMessages.length,2);assert.equal(result.outputMessages[1].data.state,true);assert.equal(result.outputMessages[1].data.outputs[0].screen,"1")
 await fs.writeFile('../output/audit-fixes-camera-state.json',JSON.stringify(result,null,2))
 await page.evaluate(()=>window.fixtureComponent.$destroy())
 console.log('PASS: failed camera startup preserves physical configuration and restores the prior active render',result)
}finally{await browser.close()}

