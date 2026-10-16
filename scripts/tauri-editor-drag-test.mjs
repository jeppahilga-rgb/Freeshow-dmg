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
    const storesUrl = await page.evaluate(() => new URL('/src/frontend/stores.ts',location.href).href)
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


    await page.evaluate(()=>{const s=window.smoothStores;s.activePage.set('edit');s.activeEdit.set({slide:0,items:[0],showId:'smooth'})})
    await page.locator('.editItem.item[data-index="0"]').waitFor({timeout:120000})
    const result=await page.evaluate(async()=>{
      const read=store=>{let value;store.subscribe(v=>value=v)();return value},s=window.smoothStores;
      const item=document.querySelector('.editItem.item[data-index="0"]'),b=item.getBoundingClientRect();
      const before=read(s.showsCache).smooth.slides.slide0.items[0].style;
      let writes=0;const unsub=s.showsCache.subscribe(()=>writes++);writes=0;
      const startX=b.x+50,startY=b.y+40;
      item.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:startX,clientY:startY,button:0,buttons:1,ctrlKey:true}));
      await new Promise(r=>setTimeout(r,0));
      for(let i=1;i<=100;i++)window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:startX+i,clientY:startY+45,buttons:1,ctrlKey:true,altKey:true}));
      window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:startX+100,clientY:startY+45}));
      await new Promise(r=>setTimeout(r,100));
      const after=read(s.showsCache).smooth.slides.slide0.items[0].style,atRelease=writes;
      await new Promise(r=>setTimeout(r,150));unsub();
      const {undo,redo}=await import('/src/frontend/components/helpers/history.ts');
      const {getStyles}=await import('/src/frontend/components/helpers/style.ts');
      undo(); await new Promise(r=>setTimeout(r,20));
      const undone=getStyles(read(s.showsCache).smooth.slides.slide0.items[0].style);
      redo(); await new Promise(r=>setTimeout(r,20));
      const redone=read(s.showsCache).smooth.slides.slide0.items[0].style;
      return {before,after,writes,atRelease,undone,redone};
    });
    assert.notEqual(result.before,result.after,'release must save the final drag');
    assert.equal(result.writes,result.atRelease,'no late movement after release');
    assert.ok(result.writes<20,'burst must not write once per pointer event');
    assert.equal(parseFloat(result.undone.left),0,'undo restores horizontal position');
    assert.equal(parseFloat(result.undone.top),0,'undo restores vertical position');
    assert.equal(result.redone,result.after,'redo restores the final position');
    console.log('PASS editor drag burst and release',result)
}finally{await browser.close()}
