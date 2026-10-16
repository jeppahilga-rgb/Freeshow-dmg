import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),{wsServer:Server}=require('../node_modules/playwright-core/lib/utilsBundle.js');
const sockets=[],requests=[];const server=new Server({host:'127.0.0.1',port:0});await new Promise(r=>server.once('listening',r));
server.on('connection',socket=>{sockets.push(socket);socket.send(JSON.stringify({op:0,d:{rpcVersion:1}}));socket.on('message',raw=>{const m=JSON.parse(raw);if(m.op===1)socket.send(JSON.stringify({op:2,d:{negotiatedRpcVersion:1}}));if(m.op===6){requests.push(m.d.requestType);const data=m.d.requestType==='GetSceneList'?{currentProgramSceneName:'Fixture A',scenes:[{sceneIndex:0,sceneName:'Fixture A'}]}:{};socket.send(JSON.stringify({op:7,d:{requestType:m.d.requestType,requestId:m.d.requestId,requestStatus:{result:true,code:100},responseData:data}}));}})});
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
    const page = await browser.newPage()
    await page.route('**/*', route => ['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
    await page.exposeFunction('fixtureInvoke', async (command, args) => {
        if (command.startsWith('plugin:event|')) return 1
        if (command === 'read_store' || command === 'show_index') return {}
        if (command === 'native_sources') return []; if(command==='local_server_start')return {urls:['http://127.0.0.1:5510']}; if(command==='media_files')return []
        if (command === 'network_ips') return ['127.0.0.1']
        if (command === 'window_action' && args.action === 'GET_DISPLAYS') return []
        if (command === 'app_info') return ({ VERSION: '1.6.6-smooth-fixture', IS_DEV: true, GET_OS: { platform: 'win32',name:'fixture' }, DATA_PATH: 'C:/Fixture', GET_CACHE_PATH: 'C:/Fixture/cache', DEVICE_ID: 'smooth-fixture' })[args.key]
        return null
    })
    await page.addInitScript(() => {
        let next = 1
        window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, invoke: (c, a) => window.fixtureInvoke(c, a), transformCallback: () => next++, unregisterCallback: () => {}, convertFileSrc: f => f }
        window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
    })
    await page.goto('http://127.0.0.1:3000', { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.waitForFunction(() => window.api)
    await page.waitForTimeout(3000)
    const storesUrl = await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name).filter(u => new URL(u).pathname.endsWith('/stores.ts')).at(-1))
    await page.evaluate(async url => {
        const s = window.smoothStores = await import(url)
        const slides = {}, layout = []
        for (let i = 0; i < 40; i++) {
            const id = `slide${i}`
            slides[id] = { group: `Slide ${i + 1}`, color: null, settings: {}, notes: '', items: Array.from({ length: 5 }, (_, j) => ({ type: 'text', auto: false, textFit: 'none', style: `left:0;top:${j * 150}px;width:1920px;height:150px;font-size:80px;`, lines: [{ align: 'center', text: [{ value: `Slide ${i + 1} / text ${j + 1}`, style: '' }] }] })) }
            layout.push({ id })
        }
        s.showsCache.set({ smooth: { name: 'Smooth fixture', category: null, settings: { activeLayout: 'main', template: false }, timestamps: { created: 1, modified: 2, used: null }, slides, layouts: { main: { name: 'Default', slides: layout } }, media: {}, meta: {}, quickAccess: {} } })
        s.shows.set({ smooth: { name: 'Smooth fixture', category: null, timestamps: { created: 1, modified: 2, used: null } } })
        s.outputs.set({ test: { name: 'Test output', enabled: true, active: true, color: '#ff008c', style: 'default', out: {}, bounds: { x: 0, y: 0, width: 1920, height: 1080 } } })
        s.transitionData.set({ text: { type: 'none', duration: 0 }, media: { type: 'none', duration: 0 }, overlay: { type: 'none', duration: 0 } })
        s.activeShow.set({ id: 'smooth', type: 'show' })
        s.activePage.set('show'); s.activePopup.set(null); s.outLocked.set(false)
        s.slidesOptions.update(v => ({ ...v, mode: 'grid', columns: 4 }))
    }, storesUrl)


    await page.evaluate(async port=>{
        const s=window.smoothStores;s.obsData.set({enabled:true,ip:'127.0.0.1',port,password:''});
        const {default:OBS}=await import('/@fs/C:/Users/User/Documents/ChatGPT/Freeshow/upstream/src/frontend/components/drawer/pages/OBS.svelte');
        const target=document.createElement('div');target.id='audit-obs';document.body.append(target);window.auditOBS=new OBS({target,props:{searchValue:''}});
    },server.address().port);
    await page.locator('#audit-obs').getByText('Connect to OBS Studio',{exact:true}).click();
    await page.locator('#audit-obs').getByText('Fixture A',{exact:true}).first().waitFor({timeout:10000});
    await page.waitForTimeout(300);
    await page.evaluate(()=>window.auditOBS.$destroy());
    const count=requests.length;
    for(const socket of sockets)socket.send(JSON.stringify({op:5,d:{eventType:'SceneItemCreated',eventData:{sceneName:'Fixture A'}}}));
    await page.waitForTimeout(500);
    const result={requestsAfterUnmount:requests.slice(count)}; if(result.requestsAfterUnmount.length) throw Error('OBS listeners remain after unmount');
    console.log(JSON.stringify(result));await fs.writeFile('tauri-test-output/ui-audit/obs-lifecycle.json',JSON.stringify(result,null,2));
} finally { await browser.close();for(const socket of sockets)socket.terminate();await new Promise(resolve=>server.close(resolve)); }
