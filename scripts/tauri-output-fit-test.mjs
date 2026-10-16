import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
    const page = await browser.newPage({deviceScaleFactor:Number(process.env.OUTPUT_TEST_DPR || 1)})
    await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:3000') ? route.continue() : route.abort())
    await page.exposeFunction('fixtureInvoke', async (command, args) => {
        if (command.startsWith('plugin:event|')) return 1
        if (command === 'read_store' || command === 'show_index') return {}
        if (command === 'native_sources') return []
        if (command === 'network_ips') return ['127.0.0.1']
        if (command === 'window_action' && args.action === 'GET_DISPLAYS') return []
        if (command === 'app_info') return ({ VERSION: '1.6.6-smooth-fixture', IS_DEV: false, GET_OS: { platform: 'win32' }, DATA_PATH: 'C:/Fixture', GET_CACHE_PATH: 'C:/Fixture/cache', DEVICE_ID: 'smooth-fixture' })[args.key]
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

    await page.evaluate(() => {
        const s = window.smoothStores;
        s.showsCache.update(v => { v.smooth.slides.slide0.items = [0,1040].map((top,i) => ({type:'text',auto:false,textFit:'none',style:'left:0;top:'+top+'px;width:1920px;height:40px;font-size:30px;',lines:[{align:'center',text:[{value:i?'BOTTOM EDGE':'TOP EDGE',style:''}]}]})); return v; });
        s.outputs.update(v => ({...v,test:{...v.test,out:{slide:{id:'smooth',layout:'main',index:0}}}}));
        s.currentWindow.set('output');
        // Native output windows have no editor status footer.
        document.body.style.height = '';
        document.getElementById('tauri-status')?.remove();
    });
    await page.getByText('BOTTOM EDGE',{exact:true}).waitFor({timeout:10000});
    const results=[];
    for(const size of [{width:1920,height:1080},{width:1280,height:800},{width:1024,height:768},{width:800,height:600},{width:1280,height:1024},{width:1280,height:720},{width:800,height:1280}]) {
        await page.setViewportSize(size); await page.evaluate(size => window.smoothStores.outputs.update(v=>({...v,test:{...v.test,bounds:{x:0,y:0,...size}}})),size); await page.waitForFunction(() => {
            const canvas=document.querySelector('.zoomed > .slide')?.getBoundingClientRect();
            const bottom=[...document.querySelectorAll('.item')].find(e=>e.textContent.includes('BOTTOM EDGE'))?.getBoundingClientRect();
            return canvas && bottom && canvas.y >= -0.1 && canvas.bottom <= innerHeight + 0.1 && Math.abs(bottom.bottom-canvas.bottom)<0.1;
        },null,{timeout:5000});
        const r=await page.evaluate(() => {
            const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}};
            return {viewport:{width:innerWidth,height:innerHeight},canvas:rect(document.querySelector('.zoomed > .slide')),top:rect([...document.querySelectorAll('.item')].find(e=>e.textContent.includes('TOP EDGE'))),bottom:rect([...document.querySelectorAll('.item')].find(e=>e.textContent.includes('BOTTOM EDGE')))};
        }); results.push(r);
        assert(r.canvas.y >= -0.1 && r.canvas.bottom <= size.height + 0.1, 'Slide extends outside output');
        assert(Math.abs(r.canvas.y - (size.height - r.canvas.bottom)) < 0.1, 'Letterbox is not centered');
        assert(r.bottom.bottom <= r.canvas.bottom + 0.1 && r.top.y >= r.canvas.y - 0.1, 'Edge items are clipped: '+JSON.stringify(r));
    }
    await page.setViewportSize({width:960,height:540});
    await page.evaluate(()=>window.smoothStores.outputs.update(v=>({...v,test:{...v.test,bounds:{x:0,y:0,width:1920,height:1080},cropping:{top:100,right:0,bottom:20,left:0}}})));
    await page.waitForTimeout(500);
    const crop = await page.locator('.zoomed > .slide').boundingBox();
    assert(Math.abs(crop.y-50)<0.1 && Math.abs(crop.height-480)<0.1, 'Asymmetric crop does not respect scaled viewport margins');
    await fs.mkdir('tauri-test-output/output-fit',{recursive:true});
    await fs.writeFile('tauri-test-output/output-fit/result.json',JSON.stringify({deviceScaleFactor:Number(process.env.OUTPUT_TEST_DPR || 1),results,crop},null,2));
    console.log(JSON.stringify({deviceScaleFactor:Number(process.env.OUTPUT_TEST_DPR || 1),viewportsPassed:results.length,edgeItemsVisible:true,asymmetricCrop:crop}));
} finally { await browser.close() }
