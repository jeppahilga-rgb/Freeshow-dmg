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

    for(const mode of ['normal','notes','focus']) {
    await page.evaluate(mode=>{const s=window.smoothStores;s.slideNotesActive.set(mode==='notes');s.focusMode.set(mode==='focus')},mode)
    await page.waitForTimeout(150)
    const result=await page.evaluate(async()=>{
      const slide=document.querySelector('.editArea .slide'),area=document.querySelector('.editArea');
      const size=()=>({width:slide.getBoundingClientRect().width,style:slide.getAttribute('style')});
      const before=size();
      slide.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:-120,clientX:500,clientY:300}));
      await new Promise(r=>setTimeout(r,150));
      const after=size();
      slide.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:120,clientX:500,clientY:300}));
      await new Promise(r=>setTimeout(r,150));
      const restored=size();
      return {before,after,restored,zoomControls:area.querySelectorAll('.zoom_container').length};
    });
    console.log(mode,JSON.stringify(result));
    assert.ok(result.after.width>result.before.width,'Ctrl-wheel up must enlarge the editor slide');
    assert.ok(Math.abs(result.restored.width-result.before.width)<1,'Ctrl-wheel down must restore the size');
    assert.equal(result.zoomControls,1,'exactly one zoom handler must remain mounted');
    const zoom=page.locator('.editArea .zoom_container')
    await zoom.locator(':scope > button').click()
    const beforeClick=await page.locator('.editArea .slide').evaluate(e=>e.getBoundingClientRect().width)
    await zoom.locator('.zoom_popup button').nth(1).click()
    await page.waitForTimeout(100)
    const afterClick=await page.locator('.editArea .slide').evaluate(e=>e.getBoundingClientRect().width)
    assert.ok(afterClick>beforeClick,'plus control must enlarge slide')
    await zoom.locator('.zoom_popup button').nth(2).click()
    await page.waitForTimeout(100)
    const restoredClick=await page.locator('.editArea .slide').evaluate(e=>e.getBoundingClientRect().width)
    assert.ok(Math.abs(restoredClick-beforeClick)<1,'minus control must restore slide')
    await zoom.locator(':scope > button').click()
    }
}finally{await browser.close()}
