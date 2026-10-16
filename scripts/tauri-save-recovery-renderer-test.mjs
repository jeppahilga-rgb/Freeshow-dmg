import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
let mode='fail', held=[]
const saves=[],closed=[]
try {
    const page=await browser.newPage()
    await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:3000')?route.continue():route.abort())
    await page.exposeFunction('testInvoke',async(command,args)=>{
        if(command.startsWith('plugin:event|'))return 1
        if(command==='save_library'){
            console.log(`save ${saves.length+1}: ${mode}`)
            saves.push(args.data)
            if(mode==='fail')throw Error('Simulated disk unavailable')
            if(mode==='hold')return new Promise(resolve=>held.push(resolve))
            return {}
        }
        if(command==='read_store')return {}
        if(command==='show_index')return {}
        if(command==='native_sources')return []
        if(command==='network_ips')return ['127.0.0.1']
        if(command==='media_files')return {}
        if(command==='window_action'){
            if(args.action==='CLOSE')closed.push(args)
            if(args.action==='GET_DISPLAYS')return [{id:1,bounds:{x:0,y:0,width:1920,height:1080},size:{width:1920,height:1080},scaleFactor:1}]
            return false
        }
        if(command==='app_info')return ({VERSION:'1.6.6-audit-fixture',IS_DEV:false,GET_OS:{platform:'win32'},DATA_PATH:'C:/Fixture',GET_CACHE_PATH:'C:/Fixture/cache',DEVICE_ID:'fixture'})[args.key]
        return null
    })
    await page.addInitScript(()=>{
        let next=1;const callbacks={}
        window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},invoke:(c,a)=>window.testInvoke(c,a),transformCallback:fn=>{callbacks[next]=fn;return next++},unregisterCallback:id=>delete callbacks[id],convertFileSrc:f=>f}
        window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}}
    })
    await page.goto('http://127.0.0.1:3000',{waitUntil:'domcontentloaded',timeout:120000})
    await page.waitForFunction(()=>window.api)
    await page.waitForTimeout(2500)
    const base=await page.evaluate(()=>performance.getEntriesByType('resource').map(e=>e.name).filter(u=>new URL(u).pathname.endsWith('/stores.ts')).at(-1))
    const saveUrl=await page.evaluate(()=>performance.getEntriesByType('resource').map(e=>e.name).filter(u=>new URL(u).pathname.endsWith('/utils/save.ts')).at(-1))
    await page.evaluate(async ({base,saveUrl})=>{
        window.auditStores=await import(base);window.auditSave=await import(saveUrl)
        window.auditRead=key=>{let value;window.auditStores[key].subscribe(v=>value=v)();return value}
        const s=window.auditStores;s.activePopup.set(null);s.special.update(v=>({...v,showClosePopup:false}));s.deletedShows.set([{id:'removed',name:'Removed'}]);s.renamedShows.set([{id:'renamed',name:'New',oldName:'Old'}]);s.saved.set(false)
        window.auditSave.save()
    },{base,saveUrl})
    await page.waitForFunction(()=>window.auditRead('alertMessage').includes('Simulated disk unavailable'))
    console.log('save failure recovered')
    assert.equal(await page.evaluate(()=>window.auditRead('statusIndicator')),'')
    assert.equal((await page.evaluate(()=>window.auditRead('deletedShows'))).length,1)
    assert.equal((await page.evaluate(()=>window.auditRead('renamedShows'))).length,1)
    assert.equal(await page.evaluate(()=>window.auditRead('saved')),false)
    mode='hold'
    await page.evaluate(()=>{window.auditStores.activePopup.set(null);window.auditSave.save()})
    const waitHeld=async()=>{
        const deadline=Date.now()+10000
        while(!held.length&&Date.now()<deadline)await page.waitForTimeout(50)
        if(!held.length)throw Error('No pending native save: '+JSON.stringify(await page.evaluate(()=>({status:window.auditRead('statusIndicator'),saved:window.auditRead('saved'),alert:window.auditRead('alertMessage')}))))
    }
    await waitHeld()
    await page.evaluate(()=>{
        const s=window.auditStores;s.deletedShows.update(v=>[...v,{id:'later',name:'Later'}]);s.renamedShows.update(v=>[...v,{id:'laterRename',name:'Later',oldName:'Earlier'}]);s.overlays.set({notice:{name:'Edited during save',items:[]}})
    })
    held.shift()({})
    await page.waitForFunction(()=>window.auditRead('deletedShows').length===1)
    assert.equal((await page.evaluate(()=>window.auditRead('deletedShows')))[0].id,'later')
    assert.equal((await page.evaluate(()=>window.auditRead('renamedShows')))[0].id,'laterRename')
    assert.equal(await page.evaluate(()=>window.auditRead('saved')),false)
    console.log('retry acknowledged only original operations')
    await page.evaluate(()=>{window.auditSave.save();window.auditSave.initializeClosing()})
    await waitHeld()
    await page.evaluate(()=>window.auditStores.overlays.set({notice:{name:'Newest edit before close',items:[]}}))
    held.shift()({})
    await waitHeld()
    assert.equal(closed.length,0,'Closed before the newest edit was saved')
    assert.equal(saves.at(-1).OVERLAYS.notice.name,'Newest edit before close')
    held.shift()({})
    const deadline=Date.now()+10000
    while(!closed.length&&Date.now()<deadline)await page.waitForTimeout(50)
    assert.equal(closed.length,1)
    console.log(JSON.stringify({saveFailureRetainsPendingOperations:true,retryAcknowledgesOnlySavedOperations:true,editsDuringSaveRemainUnsaved:true,closeWaitsForNewestEdit:true,saveCalls:saves.length}))
} finally {await browser.close()}
