import { chromium } from 'playwright'
import { io } from 'socket.io-client'
import assert from 'node:assert/strict'
import dgram from 'node:dgram'
import net from 'node:net'
const app = await chromium.connectOverCDP('http://127.0.0.1:9224')
const context = app.contexts()[0]
let main
for (const page of context.pages()) if (await page.evaluate(() => window.__TAURI_INTERNALS__?.metadata.currentWindow.label).catch(() => '') === 'main') main = page
await main.waitForFunction(() => window.api, null, { timeout: 60000 })
const base = await main.evaluate(() => performance.getEntriesByType('resource').map(e => e.name).find(u => u.endsWith('/stores.ts'))?.replace(/stores.ts$/, '') || null)
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const clientContext = await browser.newContext()
await clientContext.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
const sockets = [], kinds = ['remote', 'stage', 'controller', 'output_stream', 'companion']
const ports = { remote: 15510, stage: 15511, controller: 15512, output_stream: 15513, companion: 15505 }
const config = { id: 'connections-probe', name: 'Local connection test', enabled: true, active: false, bounds: { x: 50, y: 50, width: 640, height: 360 }, boundsLocked: true, alwaysOnTop: false, out: {} }
const invoke = (command, args) => main.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args })
function response(socket, event, expected, send) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { socket.off(event, receive); reject(Error(`Timed out: ${event}/${expected}`)) }, 15000)
        const receive = msg => { if (expected && msg.channel !== expected && msg.action !== expected) return; clearTimeout(timeout); socket.off(event, receive); resolve(msg) }
        socket.on(event, receive); send?.()
    })
}
async function connect(kind, info, transports = ['websocket']) {
    const url = new URL(info.urls[0]); url.hostname = '127.0.0.1'
    const socket = io(url.origin, { query: { token: url.searchParams.get('token') }, transports, auth: kind === 'companion' ? { password: 'fixture-api' } : {} })
    sockets.push(socket)
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); setTimeout(() => reject(Error('Connection timed out')), 10000).unref() })
    return { socket, url: url.href }
}
try {
    if (base) await main.evaluate(async ({ base, config }) => {
        const stores = await import(base + 'stores.ts'); const get = s => { let v; s.subscribe(a => v = a)(); return v }
        window.localOriginal = Object.fromEntries(['serverData', 'outputs', 'stageShows'].map(k => [k, structuredClone(get(stores[k]))]))
        stores.outputs.set({ [config.id]: config })
        stores.serverData.set({ remote: { password: 'fixture-remote' }, companion: { enabled: true, password: 'fixture-api' }, output_stream: { outputId: config.id } })
        stores.stageShows.set({ fixture: { name: 'Stage connection fixture', password: 'fixture-stage', settings: { output: config.id }, items: { current_output: { type: 'current_output', enabled: true, align: 'center', style: 'width:1920px;height:1080px;left:0;top:0;' } } } })
    }, { base, config })
    await invoke('local_server_data', { data: { output_stream: { outputId: config.id } } })
    const infos = {}
    for (const kind of kinds) infos[kind] = await invoke('local_server_start', { kind, port: ports[kind], password: kind === 'companion' ? 'fixture-api' : '', max: 20 })
    const { socket: api } = await connect('companion', infos.companion)
    async function waitSlide(present) {
        for (let i=0;i<30;i++) { const value = await response(api,'data','get_output',()=>api.emit('data',{action:'get_output',id:config.id})); if (!!value.data?.slide?.id === present) return; await main.waitForTimeout(200) }
        throw Error('Output state did not update')
    }
    await invoke('output_message', { msg: { channel: 'TOGGLE_OUTPUTS', data: { state: true, outputs: [config] } } })
    let fixture
    for (let i = 0; i < 40 && !fixture; i++) { for (const page of context.pages()) if (await page.evaluate(() => window.__TAURI_INTERNALS__?.metadata.currentWindow.label).catch(() => '') === 'output-connections-probe') fixture = page; await main.waitForTimeout(200) }
    await fixture.waitForFunction(() => window.api); await main.waitForTimeout(3000)
    const { socket: remote, url: remoteUrl } = await connect('remote', infos.remote, ['polling', 'websocket'])
    const wrong = await response(remote, 'REMOTE', 'ERROR', () => remote.emit('REMOTE', { channel: 'ACCESS', data: 'wrong' }))
    assert.equal(wrong.data, 'wrongPass')
    const shows = await response(remote, 'REMOTE', 'SHOWS', () => remote.emit('REMOTE', { channel: 'ACCESS', data: 'fixture-remote' }))
    assert.ok(Object.keys(shows.data).length > 0)
    const first = Object.keys(shows.data)[0]
    remote.emit('REMOTE', { channel: 'OUT', data: { id: first, index: 0 } })
    await waitSlide(true)
    console.log('PASS Remote polling/WebSocket, password and slide control', { shows: Object.keys(shows.data).length })
    const { socket: controller, url: controllerUrl } = await connect('controller', infos.controller)
    const target = await response(controller, 'CONTROLLER', 'GET_OUTPUT_ID', () => controller.emit('CONTROLLER', { channel: 'GET_OUTPUT_ID' }))
    assert.equal(target.data, config.id)
    controller.emit('CONTROLLER', { channel: 'ACTION', data: { id: 'clear' } })
    await waitSlide(false)
    console.log('PASS Controller controls actual output')
    const { socket: stage, url: stageUrl } = await connect('stage', infos.stage)
    const layouts = await response(stage, 'STAGE', 'LAYOUTS', () => stage.emit('STAGE', { channel: 'LAYOUTS' }))
    assert.ok(layouts.data.some(v => v.id === 'fixture'))
    const denied = await response(stage, 'STAGE', 'ERROR', () => stage.emit('STAGE', { channel: 'LAYOUT', data: { id: 'fixture', password: 'wrong' } }))
    assert.equal(denied.data, 'wrongPass')
    await response(stage, 'STAGE', 'LAYOUT', () => stage.emit('STAGE', { channel: 'LAYOUT', data: { id: 'fixture', password: 'fixture-stage' } }))
    console.log('PASS Stage View layout selection and password')
    await fixture.evaluate(() => { document.body.innerHTML = '<div style="position:fixed;inset:0;background:rgb(22,196,91)"></div>' })
    const stageFrame = await response(stage, 'STAGE', 'STREAM_FRAME', () => stage.emit('STAGE', { channel: 'STREAM_SUBSCRIBE', data: { outputId: config.id } }))
    assert.ok(stageFrame.data.jpeg.startsWith('data:image/jpeg;base64,')); assert.equal(stageFrame.data.size.width, 640)
    await main.waitForTimeout(500)
    const controllerFrame = await response(controller, 'CONTROLLER', 'OUTPUT_FRAME', () => controller.emit('CONTROLLER', { channel: 'OUTPUT_FRAME', data: { outputId: config.id } }))
    assert.ok(controllerFrame.data.frame.startsWith('data:image/jpeg;base64,'))
    const { socket: stream, url: streamUrl } = await connect('output_stream', infos.output_stream)
    const outputFrame = await response(stream, 'OUTPUT_STREAM', 'STREAM')
    assert.equal(outputFrame.data.size.width, 640)
    console.log('PASS Stage mirror, Controller preview and Output Stream receive native frames')
    const streamPage = await clientContext.newPage(); await streamPage.goto(streamUrl)
    await streamPage.waitForFunction(() => { const canvas = document.querySelector('canvas'); if (!canvas?.width || !canvas.height) return false; return canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data[1] > 180 }, null, { timeout: 20000 })
    for (const [kind, url] of [['remote', remoteUrl], ['stage', stageUrl], ['controller', controllerUrl]]) {
        const p = await clientContext.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message)); await p.goto(kind === 'stage' ? url + '&password=fixture-stage' : url)
        if (kind === 'remote') { await p.locator('#password-input').fill('fixture-remote'); await p.locator('button[type=submit]').click(); await p.locator('.auth-page').waitFor({ state: 'hidden' }) }
        if (kind === 'stage') await p.waitForFunction(() => { const c = document.querySelector('canvas'); return c?.width && c?.height && c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data[1] > 180 }, null, { timeout: 20000 })
        if (kind === 'controller') { await p.locator('.toggles button').last().click(); await p.locator('.thumbnail img').waitFor() }
        await p.waitForTimeout(500); assert.deepEqual(errors, []); await p.close()
    }
    console.log('PASS all four bundled browser clients load offline; Output Stream renders captured pixels')
    const apiShows = await response(api, 'data', 'get_shows', () => api.emit('data', { action: 'get_shows' }))
    assert.ok(apiShows.data)
    const variables = await response(api, 'data', null, () => api.emit('data', { isVariable: true, keys: [] }))
    assert.equal(variables.isVariable, true)
    const unauthorized=io(`http://127.0.0.1:${ports.companion}`,{transports:['websocket'],auth:{password:'wrong'}});sockets.push(unauthorized)
    await new Promise((resolve,reject)=>{unauthorized.once('connect',resolve);unauthorized.once('connect_error',reject)})
    const rejected=await response(unauthorized,'data',null,()=>unauthorized.emit('data',{action:'get_shows'}));assert.equal(rejected.error,'Unauthorized')
    const bad = await fetch(`http://127.0.0.1:${ports.companion + 1}/?action=get_shows`); assert.equal(bad.status, 401)
    const rest = await fetch(`http://127.0.0.1:${ports.companion + 1}/?action=get_shows`, { headers: { Authorization: 'Bearer fixture-api' } }); assert.equal(rest.status, 200); assert.equal((await rest.json()).action, 'get_shows')
    const malformed=await fetch(`http://127.0.0.1:${ports.companion+1}/`,{method:'POST',headers:{Authorization:'Bearer fixture-api'},body:'null'});assert.equal(malformed.status,400)
    const oversized=await fetch(`http://127.0.0.1:${ports.companion+1}/`,{method:'POST',headers:{Authorization:'Bearer fixture-api'},body:'x'.repeat(70000)});assert.equal(oversized.status,413)
    const osc = dgram.createSocket('udp4'); await new Promise(r => osc.bind(0, '127.0.0.1', r))
    const pad = text => { const b = Buffer.from(text + '\0'); return Buffer.concat([b, Buffer.alloc((4 - b.length % 4) % 4)]) }
    const oscResult = new Promise((resolve, reject) => { osc.once('message', resolve); setTimeout(() => reject(Error('OSC timeout')), 12000).unref() })
    osc.send(Buffer.concat([pad('/freeshow/get_shows'), pad(',s'), pad(JSON.stringify({ password: 'fixture-api' }))]), ports.companion, '127.0.0.1')
    const reply = await oscResult; osc.close(); assert.ok(reply.includes(Buffer.from('get_shows')),reply.toString().slice(0,180))
    console.log('PASS Companion Socket.IO actions/variables, REST password, OSC UDP')
    assert.equal((await fetch(`http://127.0.0.1:${ports.remote}/`)).status, 200)
    assert.equal((await fetch(`http://127.0.0.1:${ports.stage}/`)).status, 403)
    const mobile = io(`http://127.0.0.1:${ports.remote}`, { transports: ['websocket'] })
    sockets.push(mobile)
    await new Promise((resolve, reject) => { mobile.once('connect', resolve); mobile.once('connect_error', reject) })
    const blocked = await response(mobile, 'REMOTE', 'ERROR', () => mobile.emit('REMOTE', { channel: 'OUT', data: 'clear' }))
    assert.equal(blocked.data, 'wrongPass')
    const mobileShows = await response(mobile, 'REMOTE', 'SHOWS', () => mobile.emit('REMOTE', { channel: 'ACCESS', data: 'fixture-remote' }))
    assert.ok(Object.keys(mobileShows.data).length > 0)
    const occupied = net.createServer(); await new Promise(r => occupied.listen(0, '0.0.0.0', r))
    await assert.rejects(invoke('local_server_start', { kind: 'remote', port: occupied.address().port }), /port/)
    await new Promise(r => occupied.close(r)); assert.equal((await fetch(remoteUrl)).status, 200)
    console.log('PASS mobile Remote bare address and password login; Stage pairing enforced; occupied port preserves running server')
} finally {
    sockets.forEach(socket => socket.disconnect())
    for (const kind of kinds) await invoke('local_server_stop', { kind }).catch(() => {})
    await invoke('output_message', { msg: { channel: 'TOGGLE_OUTPUTS', data: { state: false, outputs: [config] } } }).catch(() => {})
    if (base) await main.evaluate(async base => { const s = await import(base + 'stores.ts'); if (window.localOriginal) for (const [key, value] of Object.entries(window.localOriginal)) s[key].set(value) }, base).catch(() => {})
    await browser.close(); await app.close()
}
