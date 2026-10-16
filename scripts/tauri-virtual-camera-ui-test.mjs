import {chromium} from 'playwright'
import assert from 'node:assert/strict'
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try{
    const page=await browser.newPage()
    await page.route('**/camera-fixture',route=>route.fulfill({contentType:'text/html',body:'<div id="fixture"></div>'}))
    await page.addInitScript(()=>{
        window.cameraCalls=[];window.cameraRunning=false;window.cameraFailure=false
        window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
            if(command==='output_message'){window.cameraCalls.push(args.msg);return} if(command!=='virtual_camera')throw Error('Unexpected command')
            window.cameraCalls.push(args)
            if(args.action==='start'){if(window.cameraFailure)throw Error('Install camera component first');window.cameraRunning=true}
            if(args.action==='stop')window.cameraRunning=false
            return {running:window.cameraRunning,output:window.cameraRunning?'center':null}
        }}
    })
    await page.goto('http://127.0.0.1:3000/camera-fixture')
    await page.evaluate(async()=>{const stores=await import('/src/frontend/stores.ts');const module=await import('/src/frontend/components/settings/tabs/VirtualCameraOutput.svelte');stores.outputs.set({center:{enabled:true,name:'Camera',bounds:{x:0,y:0,width:1280,height:720}}});window.cameraComponent=new module.default({target:document.querySelector('#fixture'),props:{outputId:'center',enabled:true}})})
    await page.getByRole('button',{name:'Start virtual camera'}).click()

    await page.getByRole('button',{name:'Stop virtual camera'}).waitFor()
    assert(await page.evaluate(()=>window.cameraCalls.some(call=>call.channel==='TOGGLE_OUTPUTS'&&call.data.state&&call.data.outputs[0].id==='center'&&call.data.outputs[0].virtualCamera&&call.data.outputs[0].screen===null&&call.data.outputs[0].alwaysOnTop===false)))
    assert(await page.evaluate(()=>window.cameraCalls.some(call=>call.action==='start'&&call.output==='center')))
    await page.getByRole('button',{name:'Stop virtual camera'}).click()
    await page.getByRole('button',{name:'Start virtual camera'}).waitFor()
    await page.evaluate(()=>{window.cameraFailure=true})
    await page.getByRole('button',{name:'Start virtual camera'}).click()
    await page.getByRole('alert').getByText('Install camera component first',{exact:false}).waitFor()
    await page.evaluate(()=>window.cameraComponent.$destroy())
    console.log('Virtual camera UI passed: start, stop, selected output, and installation error.')
}finally{await browser.close()}
