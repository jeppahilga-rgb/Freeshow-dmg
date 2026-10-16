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

    const result=await page.evaluate(async()=>{
        const s=window.smoothStores,read=store=>{let value;store.subscribe(v=>value=v)();return value};
        s.outputs.set({center:{name:'Center',enabled:true,active:true,color:'#ff008c',style:'default',bounds:{x:0,y:0,width:1920,height:1080},out:{effects:[]}},side:{name:'Side',enabled:true,active:true,color:'#ff008c',style:'default',bounds:{x:0,y:0,width:1920,height:1080},out:{effects:[]}}});
        s.effects.set({bound:{name:'Bound',bindings:['center'],items:[]},global:{name:'Global',items:[]}});
        const {setOutput}=await import('/src/frontend/components/helpers/output.ts');
        setOutput('effects',['bound','global'],false,'center');setOutput('effects',['bound','global'],false,'side');
        const outputData=read(s.outputs);
        if(JSON.stringify(outputData.center.out.effects)!==JSON.stringify(['bound','global'])||JSON.stringify(outputData.side.out.effects)!==JSON.stringify(['global']))throw Error('Effects output bindings failed');
        const {checkName}=await import('/src/frontend/components/helpers/show.ts');
        s.shows.set({existing:{name:'Title'}});if(checkName('Title','existing')!=='Title')throw Error('Existing imported show was renamed');
        const {exportProjectAsData}=await import('/src/frontend/components/export/projectLink.ts');
        const data=await exportProjectAsData({name:'Sections',shows:[{type:'section',id:'section',name:'Welcome',notes:'Hello',data:{time:120}}]},'p');
        if(data.items[0].type!=='section'||data.items[0].name!=='Welcome'||data.items[0].data.notes!=='Hello'||data.items[0].data.time!==120)throw Error('Project section export lost data');
        s.special.update(value=>({...value,outputPreviewGrid:2}));
        return {effectBindings:true,existingShowName:true,projectSections:true};
    });
    await page.locator('.multipleOutputs').first().waitFor();
    await page.locator('.multipleOutputs').first().dispatchEvent('wheel',{ctrlKey:true,deltaY:-100});
    assert.equal(await page.evaluate(()=>{let value;smoothStores.special.subscribe(v=>value=v.outputPreviewGrid)();return value}),1);
    console.log('PASS: beta effects bindings, imported-show identity, project sections and Ctrl-wheel preview grid',JSON.stringify(result));
    await fs.writeFile('../output/BETA-PORT-UI-VERIFICATION.json',JSON.stringify({...result,previewZoom:true},null,2));
} finally {await browser.close()}
