import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'

const pdfTest = process.argv.includes('--pdf')
const pptx = process.argv.includes('--pptx')
const dropTest = process.argv.includes('--drop')
const root = path.resolve(dropTest ? 'tauri-test-output/drop-renderer' : pptx ? 'tauri-test-output/import-powerpoint/renderer' : 'tauri-test-output/import-renderer')
await fs.mkdir(root, { recursive: true })
const pptxPackage = pptx ? JSON.parse(await fs.readFile('tauri-test-output/import-powerpoint/package.json', 'utf8')) : null
const allowedAssets = new Set(Object.values(pptxPackage?.contentPaths || {}))
let assetReads = 0
const fixture = pdfTest ? path.resolve('tauri-test-output/slidesgo-faithful.pdf') : pptx ? 'C:/Users/User/Downloads/Tech Trends 2026 by Slidesgo.pptx' : path.join(root, 'Import test.txt')
if (!pptx && !pdfTest) await fs.writeFile(fixture, 'Import renderer fixture\n\nVerse one\nVerse two')
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true })
let page
const errors = []
try {
    page = await browser.newPage()
    const commands = []
    const dragTraces = []
    page.on('console', async message => {
        if (message.text().includes('Failed to load local font')) console.log(message.text())
        if (message.text().includes('[Tauri preview]') && /Import|IMPORT|PDF/.test(message.text())) console.log(message.text())
        if (/^(DRAG:|DROP:|NOT ASSIGNED|Missing slide drop)/.test(message.text())) dragTraces.push(await Promise.all(message.args().map(arg=>arg.jsonValue().catch(()=>null))))
    })
    const transfers = new Map()
    await page.route('**/*', async route => {
        const url = new URL(route.request().url())
        if (!['127.0.0.1','localhost'].includes(url.hostname)) return route.abort()
        if (url.pathname === '/__testasset') {
            const file = path.resolve(url.searchParams.get('path'))
            if (!allowedAssets.has(file)) return route.abort()
            const type = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml' })[path.extname(file).toLowerCase()] || 'application/octet-stream'
            assetReads++
            return route.fulfill({ body: await fs.readFile(file), contentType: type })
        }
        return route.continue()
    })
    page.on('pageerror', e => errors.push(e.message))
    
    await page.exposeFunction('testInvoke', async (cmd, args) => {
        commands.push(cmd)
        if (cmd.startsWith('plugin:event|')) return 1
        if (cmd === 'dropped_files') {
            const r = args.request
            if (r.action === 'start') { const token = Date.now().toString() + "-" + transfers.size; const folder = path.join(root, 'copies', token); await fs.mkdir(folder, { recursive: true }); transfers.set(token, folder); return { token, path: folder }; }
            const folder = transfers.get(r.token)
            if (r.action === 'append' || r.action === 'directory') {
                const target = path.resolve(folder, r.relative)
                assert(target.startsWith(folder + path.sep))
                if (r.action === 'directory') await fs.mkdir(target, { recursive: true })
                else { await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, Buffer.from(r.bytes), { flag: r.offset === 0 ? 'wx' : 'a' }); allowedAssets.add(target); }
            }
            return null
        }
        if (cmd === 'media_files') {
            if (args.operation === 'THUMBNAIL_CACHE') return null
            if (args.operation === 'STORE_THUMBNAIL') {
                const target = path.resolve(root, 'media-cache', `${allowedAssets.size}.png`)
                await fs.mkdir(path.dirname(target), { recursive: true })
                await fs.writeFile(target, Buffer.from(args.data.bytes))
                allowedAssets.add(target)
                return { input: args.data.input, output: target, size: args.data.size }
            }
            if (args.operation === 'READ_FOLDER') return {}
            if (args.operation === 'DOES_MEDIA_EXIST') return { path: args.data.path, exists: true }
        }
        if (cmd === 'document_pdf') return Array.from(await fs.readFile('tauri-test-output/slidesgo-faithful.pdf'))
        if (cmd === 'import_powerpoint') return pptxPackage
        if (cmd === 'read_store') return {}
        if (cmd === 'show_index') return {}
        if (cmd === 'library_service' && args.operation === 'READ_FILE') return { content: await fs.readFile(args.data.path, 'utf8') }
        if (cmd === 'pick_media_files') return { files: [fixture] }
        if (cmd === 'native_sources') return []
        if (cmd === 'network_ips') return ['127.0.0.1']
        if (cmd === 'window_action') {
            if (args.action === 'GET_DISPLAYS') return [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, size: { width: 1920, height: 1080 }, scaleFactor: 1 }]
            return false
        }
        if (cmd === 'app_info') return ({ VERSION: '1.6.6-tauri-test', IS_DEV: false, GET_OS: 'win32', DATA_PATH: root, GET_CACHE_PATH: root, DEVICE_ID: 'import-test' })[args.key]
        return null
    })
    await page.addInitScript(() => {
        let next = 1
        const callbacks = {}
        window.__TAURI_INTERNALS__ = {
            metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
            invoke: (cmd, args) => window.testInvoke(cmd, args),
            transformCallback: cb => { callbacks[next] = cb; return next++ },
            unregisterCallback: id => { delete callbacks[id] },
            convertFileSrc: file => location.origin + '/__testasset?path=' + encodeURIComponent(file)
        }
        window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
    })
    await page.goto('http://127.0.0.1:3000', { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.waitForFunction(() => window.api)
    await page.waitForTimeout(5000)
    const base = await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name).filter(u => new URL(u).pathname.endsWith('/stores.ts')).at(-1))
    if (!base) throw Error('Stores module not found')
    const before = await page.evaluate(async base => {
        const s = await import(base)
        let shows
        s.shows.subscribe(v => shows = v)()
        return Object.keys(shows)
    }, base)
    await page.evaluate(({pptx,pdfTest}) => window.api.send('MAIN', { channel: 'IMPORT', data: { channel: pdfTest ? 'pdf' : pptx ? 'powerpoint' : 'txt', format: { name: pptx ? 'PowerPoint' : 'Text', extensions: [pptx ? 'pptx' : 'txt'] } } }), {pptx,pdfTest})
    await page.waitForTimeout(3000)
    if (pptx) {
        await page.waitForFunction(async base => {
            const s = await import(base)
            let cache, shows
            s.showsCache.subscribe(value => cache = value)()
            s.shows.subscribe(value => shows = value)()
            return Object.keys(shows).length > 0 && Object.values(cache).some(show => show.origin === 'powerpoint' && Object.keys(show.slides || {}).length === 32)
        }, base, { timeout: 120000 })
    }
    if (pdfTest) {
        const start = Date.now()
        while (true) {
            console.log(JSON.stringify({ seconds: Math.round((Date.now()-start)/1000), documents: commands.filter(c=>c==='document_pdf').length, pages: transfers.size }))
            const count = await page.evaluate(async base => { const s = await import(base); let shows; s.shows.subscribe(v=>shows=v)(); return Object.keys(shows).length }, base)
            if (count) break
            if (Date.now()-start > 600000) throw Error('PDF did not create a show within ten minutes')
            await page.waitForTimeout(1000)
        }
    }
    if (dropTest) {
        const sendDrop = async (selector, name, text, type) => page.evaluate(({selector,name,text,type}) => {
            const target = document.querySelector(selector)
            if (!target) throw Error('Missing drop target: ' + selector)
            const data = new DataTransfer()
            data.items.add(new File([text], name, { type }))
            target.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }))
        }, {selector,name,text,type})
        await sendDrop('.drawer', 'Dropped song.txt', 'Dropped song\n\nNew verse one\nNew verse two', 'text/plain')
        await page.waitForTimeout(2000)
        await sendDrop('[data-drop-area="slides"]', 'Slide background.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="red"/></svg>', 'image/svg+xml')
        await page.waitForTimeout(2000)
        const slideMedia = await page.evaluate(async base => {
            const s = await import(base); let cache; s.showsCache.subscribe(v=>cache=v)(); return JSON.stringify(cache)
        }, base)
        assert(slideMedia.includes('Slide background.svg'), 'Dropped media was not attached to slides')
        await page.evaluate(async base => { const s = await import(base); s.activeDrawerTab.set('overlays'); s.drawerTabsData.update(v=>({...v,overlays:{...v.overlays,activeSubTab:'all'}})); }, base)
        await page.waitForTimeout(1000)
        await sendDrop('[data-drop-area="overlays"]', 'Overlay background.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="blue"/></svg>', 'image/svg+xml')
        await page.waitForTimeout(2000)
        const overlayData = await page.evaluate(async base => {const s=await import(base); let value;s.overlays.subscribe(v=>value=v)();return value},base)
        assert(Object.values(overlayData).some(o=>o.items.some(item=>item.src?.includes('Overlay background.svg'))),'Dropped overlay media was not added')
        await page.evaluate(async base => { const s=await import(base);s.activeRename.set(null) },base)
        await page.evaluate(()=>{window.dragEvents=[];for(const type of ['dragstart','dragover','drop','dragend']) document.addEventListener(type,e=>{if(type!=='dragover'||!window.dragEvents.some(e=>e.type==='dragover'))window.dragEvents.push({type,target:e.target.tagName,cls:e.target.className,x:e.clientX,y:e.clientY,types:Array.from(e.dataTransfer?.types||[])})},true)})
        const sourceBox = await page.locator('[data-drop-area="overlays"] .selectElem[draggable="true"]').first().boundingBox(); const targetBox = await page.locator('[data-drop-area="slides"]').first().boundingBox(); await page.mouse.move(sourceBox.x+sourceBox.width/2,sourceBox.y+sourceBox.height/2); await page.mouse.down(); await page.mouse.move(sourceBox.x+sourceBox.width/2+15,sourceBox.y+sourceBox.height/2,{steps:5}); await page.mouse.move(targetBox.x+targetBox.width/2,targetBox.y+targetBox.height/2,{steps:15}); await page.mouse.move(targetBox.x+targetBox.width/2+2,targetBox.y+targetBox.height/2+2); await page.mouse.up();
        await page.waitForTimeout(1000)
        const internalDrop = await page.evaluate(async base => {const s=await import(base);let value;s.showsCache.subscribe(v=>value=v)();return JSON.stringify(value)},base)
        console.log(JSON.stringify({dragTraces, dragEvents:await page.evaluate(()=>window.dragEvents), state: await page.evaluate(async base=>{const s=await import(base);const result={};for(const key of ['activeShow','activePage','selected','activeRename'])s[key].subscribe(v=>result[key]=v)();return result},base)}))
        await page.screenshot({path:path.join(root,'internal-drag.png')})
        assert(internalDrop.includes('Overlay background.svg') || Object.keys(overlayData).some(id=>internalDrop.includes(id)), 'Internal overlay drag did not add the overlay to the show')
        await page.evaluate(async base => {const s=await import(base);s.activeDrawerTab.set('templates');s.drawerTabsData.update(v=>({...v,templates:{...v.templates,activeSubTab:'all'}}))},base)
        await page.waitForTimeout(1000)
        await sendDrop('[data-drop-area="templates"]','Template background.svg','<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"/>','image/svg+xml')
        await page.waitForTimeout(1000)
        const templateData = await page.evaluate(async base => {const s=await import(base);let v;s.templates.subscribe(x=>v=x)();return v},base)
        assert(Object.values(templateData).some(t=>t.settings?.backgroundPath?.includes('Template background.svg')), 'Dropped template background was not created')
        await page.evaluate(async base => {const s=await import(base);s.activeRename.set(null);s.audioPlaylists.set({test:{name:'Test playlist',songs:[]}});s.activeDrawerTab.set('audio');s.drawerTabsData.update(v=>({...v,audio:{...v.audio,activeSubTab:'test'}}))},base)
        await page.waitForTimeout(1000)
        await sendDrop('[data-drop-area="audio_playlist"]','Dropped audio.wav','RIFF fixture audio','audio/wav')
        await page.waitForTimeout(1000)
        const playlist = await page.evaluate(async base=>{const s=await import(base);let v;s.audioPlaylists.subscribe(x=>v=x)();return v.test},base)
        assert(playlist.songs[0]?.includes('Dropped audio.wav'), 'Dropped audio was not added to the playlist')
        await page.evaluate(async base => {const s=await import(base);s.activeDrawerTab.set('media');s.drawerTabsData.update(v=>({...v,media:{...v.media,activeSubTab:'all'}}))},base)
        await page.waitForTimeout(1000)
        await sendDrop('.drawer','Library image.svg','<svg xmlns="http://www.w3.org/2000/svg"/>','image/svg+xml')
        await page.waitForTimeout(1000)
        const folders = await page.evaluate(async base=>{const s=await import(base);let v;s.mediaFolders.subscribe(x=>v=x)();return v},base)
        assert(Object.values(folders).some(f=>f.name==='Dropped files'), 'Dropped media was not registered in the library')
        assert(assetReads > 0, 'No copied media assets were loaded')
        console.log(JSON.stringify({ droppedText: true, slideMedia: true, overlayMedia: true, internalOverlayDrag: true, templateBackground: true, audioPlaylist: true, mediaLibrary: true, assetReads, transferBatches: transfers.size }))
    }
    const after = await page.evaluate(async base => {
        const s = await import(base)
        let shows, cache
        s.shows.subscribe(v => shows = v)()
        s.showsCache.subscribe(v => cache = v)()
        return { shows, cache }
    }, base)
    if (!process.argv.includes('--no-screenshot')) await page.screenshot({ path: path.join(root, 'import.png'), timeout: 60000 })
    if (process.argv.includes("--settle")) { await page.waitForTimeout(20000); console.log(JSON.stringify({settledListeners:await page.evaluate(()=>window.api.getListeners())})); }
    await fs.writeFile(path.join(root, 'result.json'), JSON.stringify({ before, after, errors, commands }, null, 2))
    console.log(JSON.stringify({ before: before.length, after: Object.keys(after.shows).length, errors, commands: commands.filter(c => ['pick_media_files','library_service'].includes(c)), listeners: await page.evaluate(() => window.api.getListeners()) }))
    assert(Object.keys(after.shows).length > before.length, 'The real frontend did not add an imported show')
    if (pdfTest) { const show=Object.values(after.cache)[0]; assert.equal(Object.keys(show.slides).length,32); assert.equal(Object.keys(show.media).length,32); console.log(JSON.stringify({pages:32,assetReads})); }
    
    if (pptx) { const show=Object.values(after.cache).find(s=>s.origin==='powerpoint'); assert(show); assert.equal(Object.keys(show.slides).length,32); const slides=Object.values(show.slides); const year=slides[0].items.find(i=>i.lines?.some(l=>l.text.some(t=>t.value==='2026'))); assert.equal(year.lines[0].align,'', 'Centered paragraph should use FreeShow center alignment'); assert(year.style.includes('padding: 19.2px'), 'Explicit text-box padding lost'); assert(!slides[0].items.some(i=>i.lines?.some(l=>l.text.some(t=>t.value==='●'))), 'Explicit no-bullet setting lost'); assert(slides[3].items.filter(i=>i.type==='media'&&i.src).length>=2, 'Preset picture was discarded'); assert(Object.values(show.slides).some(s=>s.items.some(i=>i.lines?.length))); console.log(JSON.stringify({slides:32,items:Object.values(show.slides).reduce((n,s)=>n+s.items.length,0),assetReads,fonts:await page.evaluate(()=>Array.from(document.fonts).map(f=>({family:f.family,status:f.status})))})); }
} catch (error) {
    await fs.writeFile(path.join(root,'failure.json'),JSON.stringify({message:String(error),errors,text:await page?.locator('body').innerText().catch(()=>''),html:await page?.content().catch(()=>'')},null,2))
    throw error
} finally { await browser.close() }


