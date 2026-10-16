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
    await page.locator('.grid .slide.context').nth(15).waitFor({ timeout: 30000 })
    await page.waitForTimeout(1000)
    const result = await page.evaluate(async () => {
        const s = window.smoothStores, timings = [], synchronous = [], selectionIndexes = []
        let notifications = -1
        const unsubscribe = s.showsCache.subscribe(() => notifications++)
        for (let i = 0; i < 16; i++) {
            const target = document.querySelectorAll('.grid .slide.context')[i]
            const started = performance.now()
            target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
            let outputs; s.outputs.subscribe(v => outputs = v)()
            synchronous.push(outputs.test?.out?.slide?.index === i)
            selectionIndexes.push(outputs.test?.out?.slide?.index ?? null)
            timings.push(performance.now() - started)
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        }
        unsubscribe()
        return { slides: 40, textBoxes: 200, clicks: 16, allSelectionsSynchronous: synchronous.every(Boolean), contentNotifications: notifications, selectionIndexes, medianClickHandlerMs: timings.toSorted((a,b)=>a-b)[8], maxClickHandlerMs: Math.max(...timings), samplesMs: timings }
    })
    await fs.mkdir('tauri-test-output/smooth', { recursive: true })
    await fs.writeFile('tauri-test-output/smooth/result.json', JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result))
    assert(result.allSelectionsSynchronous, 'An ordinary slide click deferred output selection')
    assert.equal(result.contentNotifications, 0, 'Playback notified the complete content store')
    await page.evaluate(() => window.smoothStores.currentWindow.set('output'))
    await page.getByText('Slide 16 / text 1', { exact: true }).first().waitFor({ state: 'visible', timeout: 10000 })
    for (let index = 16; index < 20; index++) {
        await page.evaluate(index => window.smoothStores.outputs.update(v => ({ ...v, test: { ...v.test, out: { ...v.test.out, slide: { id: 'smooth', layout: 'main', index } } } })), index)
        await page.getByText(`Slide ${index + 1} / text 1`, { exact: true }).first().waitFor({ state: 'visible', timeout: 3000 })
        await page.locator(".transitioner").getByText(`Slide ${index} / text 1`, { exact: true }).waitFor({ state: 'detached', timeout: 3000 })
    }
    await page.evaluate(() => {
        const s = window.smoothStores
        s.showsCache.update(v => {
            v.smooth.slides.slide20.items.forEach(item => { item.auto = true })
            return v
        })
        s.outputs.update(v => ({ ...v, test: { ...v.test, out: { ...v.test.out, slide: { id: 'smooth', layout: 'main', index: 20 } } } }))
    })
    await page.getByText('Slide 21 / text 1', { exact: true }).last().waitFor({ state: 'visible', timeout: 5000 })
    result.staticOutputSlidesRendered = 5
    result.autoSizedOutputRendered = true
    await page.evaluate(() => {
        const s = window.smoothStores
        s.showsCache.update(v => {
            v.smooth.slides.slide21.items[0].actions = { transition: { type: 'fade', duration: 120 } }
            return v
        })
        s.outputs.update(v => ({ ...v, test: { ...v.test, out: { ...v.test.out, slide: { id: 'smooth', layout: 'main', index: 21 } } } }))
    })
    await page.getByText('Slide 22 / text 1', { exact: true }).last().waitFor({ state: 'visible', timeout: 5000 })
    result.itemTransitionOutputRendered = true
    await fs.writeFile('tauri-test-output/smooth/result.json', JSON.stringify(result, null, 2))
    console.log(JSON.stringify({ staticOutputSlidesRendered: 5, autoSizedOutputRendered: true, itemTransitionOutputRendered: true }))
} finally { await browser.close() }



