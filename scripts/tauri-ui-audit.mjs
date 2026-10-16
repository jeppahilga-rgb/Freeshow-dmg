import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
    const page = await browser.newPage()
    await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:3000') ? route.continue() : route.abort())
    await page.exposeFunction('fixtureInvoke', async (command, args) => {
        if (command.startsWith('plugin:event|')) return 1
        if (command === 'read_store' || command === 'show_index') return {}
        if (command === 'native_sources') return []; if(command==='local_server_start')return {urls:['http://127.0.0.1:5510']}; if(command==='media_files')return []
        if (command === 'network_ips') return ['127.0.0.1']
        if (command === 'window_action' && args.action === 'GET_DISPLAYS') return []
        if (command === 'app_info') return ({ VERSION: '1.6.6-smooth-fixture', IS_DEV: true, GET_OS: { platform: 'win32',name:'fixture' }, DATA_PATH: 'C:/Fixture', GET_CACHE_PATH: 'C:/Fixture/cache', DEVICE_ID: 'smooth-fixture' })[args.key]
        return null
    })
    await page.addInitScript(() => { performance.setResourceTimingBufferSize(20000);
        let next = 1
        window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, invoke: (c, a) => window.fixtureInvoke(c, a), transformCallback: () => next++, unregisterCallback: () => {}, convertFileSrc: f => f }
        window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
    })
    await page.goto('http://127.0.0.1:3000', { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.waitForFunction(() => window.api)
    await page.waitForTimeout(3000);await page.waitForFunction(()=>performance.getEntriesByType('resource').some(e=>new URL(e.name).pathname.endsWith('/stores.ts')) && !!document.querySelector('h1'),{},{timeout:120000})
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

    let currentScreen='';const errors=[];page.on('pageerror',e=>errors.push({screen:currentScreen,message:e.message,stack:e.stack}));
    await fs.mkdir('tauri-test-output/ui-audit',{recursive:true});
    const results=[];
    for(const size of [{width:1920,height:1080},{width:1366,height:768},{width:800,height:600}]) {
        await page.setViewportSize(size);
        for(const screen of ['show','edit','settings:general','settings:display_settings','settings:files','settings:connection','settings:audio','settings:ai','drawer:media','drawer:audio','drawer:overlays','drawer:templates','popup:import','popup:choose_media_input','popup:connect']) {
            currentScreen=screen;await page.evaluate(()=>window.smoothStores.activePopup.set(null));await page.waitForTimeout(300);await page.evaluate(screen=>{
                const s=window.smoothStores;s.activePopup.set(null);
                if(screen==='edit'){s.activeEdit.set({slide:0,items:[]});s.activePage.set('edit');}
                else if(screen.startsWith('settings:')){s.activePage.set('settings');s.settingsTab.set(screen.split(':')[1]);}
                else if(screen.startsWith('drawer:')){s.activePage.set('show');s.activeDrawerTab.set(screen.split(':')[1]);}
                else if(screen.startsWith('popup:')){s.activePage.set('show');s.popupData.set(screen==='popup:connect'?{id:'remote',ip:'127.0.0.1'}:{});s.activePopup.set(screen.split(':')[1]);}
                else s.activePage.set(screen);
            },screen);
            await page.waitForTimeout(1300);
            const state=await page.evaluate(()=>{
                const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
                const clipped=[...document.querySelectorAll('button,input,select')].filter(e=>{
                    const r=e.getBoundingClientRect();return r.width&&r.height&&getComputedStyle(e).visibility!=='hidden'&&(r.x<0||r.right>innerWidth||r.y<0||r.bottom>innerHeight);
                }).map(e=>({text:(e.textContent||e.getAttribute('title')||e.getAttribute('aria-label')||e.tagName).trim().slice(0,65),...rect(e)}));
                const modal=document.querySelector('.popup .card');const status=document.querySelector('#tauri-status');
                return {horizontalOverflow:document.documentElement.scrollWidth>innerWidth,bodyText:document.body.innerText.slice(-500),clipped:clipped.slice(0,20),modal:modal?rect(modal):null,status:status?rect(status):null};
            });
            if(screen.startsWith('popup:'))assert.ok(state.modal, `Popup did not render: ${screen} at ${size.width}x${size.height}`);
            results.push({size,screen,...state});
            await page.screenshot({path:'tauri-test-output/ui-audit/'+size.width+'-'+screen.replace(':','-')+'.png'});
        }
    }
    await fs.writeFile('tauri-test-output/ui-audit/result.json',JSON.stringify({results,errors},null,2));
    console.log(JSON.stringify({screens:results.length,errors,overflow:results.filter(r=>r.horizontalOverflow).map(r=>({size:r.size,screen:r.screen,clipped:r.clipped})),modals:results.filter(r=>r.modal).map(r=>({size:r.size,screen:r.screen,modal:r.modal}))}));
} finally { await browser.close() }
