import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const browser = await chromium.connectOverCDP('http://127.0.0.1:9224')
const context = browser.contexts()[0]
const main = (await Promise.all(context.pages().map(async page => ({ page, label: await page.evaluate(() => window.__TAURI_INTERNALS__?.metadata.currentWindow.label) })))).find(p => p.label === 'main').page
const config = { id: 'detail-probe', bounds: { x: 50, y: 50, width: 960, height: 540 }, boundsLocked: true, alwaysOnTop: true }
let fixture
try {
    await main.evaluate(config => window.__TAURI_INTERNALS__.invoke('output_message', { msg: { channel: 'TOGGLE_OUTPUTS', data: { state: true, outputs: [config] } } }), config)
    for (let i = 0; i < 40 && !fixture; i++) {
        for (const page of context.pages()) if (await page.evaluate(() => window.__TAURI_INTERNALS__?.metadata.currentWindow.label).catch(() => '') === 'output-detail-probe') fixture = page
        await main.waitForTimeout(200)
    }
    await fixture.waitForFunction(() => window.api)
    await fixture.waitForTimeout(3000)
    await main.evaluate(config => window.__TAURI_INTERNALS__.invoke('output_message', { msg: { channel: 'SET_VALUE', data: { id: config.id, key: 'name', value: 'FreeShow detail fixture' } } }), config)
    await fixture.evaluate(() => {
        document.body.innerHTML = '<canvas id="detail" width="960" height="540" style="position:fixed;inset:0;width:960px;height:540px"></canvas>'
        const ctx = document.querySelector('canvas').getContext('2d')
        for (let x = 0; x < 960; x += 4) { ctx.fillStyle = x % 8 ? '#fff' : '#000'; ctx.fillRect(x, 0, 4, 540) }
    })
    const source = await main.evaluate(async () => (await window.__TAURI_INTERNALS__.invoke('native_sources')).find(s => s.name === 'FreeShow detail fixture'))
    assert.ok(source)
    const result = await main.evaluate(async id => {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id } } })
        try {
            const video = document.createElement('video'); video.muted = true; video.srcObject = stream; await video.play(); await new Promise(r => setTimeout(r, 500))
            const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight
            const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0)
            const row = ctx.getImageData(100, 100, 200, 1).data
            let edges = 0, low = 255, high = 0
            for (let i = 4; i < row.length; i += 4) { if (Math.abs(row[i] - row[i - 4]) > 150) edges++; low = Math.min(low, row[i]); high = Math.max(high, row[i]) }
            return { width: canvas.width, height: canvas.height, edges, low, high }
        } finally { stream.getTracks().forEach(t => t.stop()) }
    }, source.id)
    assert.equal(result.width, 960)
    assert.equal(result.height, 540)
    assert.ok(result.edges >= 45 && result.high - result.low > 240, JSON.stringify(result))
    console.log('PASS native capture preserves four-pixel detail through the rendered video stream', result)
} finally {
    await main.evaluate(config => window.__TAURI_INTERNALS__.invoke('output_message', { msg: { channel: 'TOGGLE_OUTPUTS', data: { state: false, outputs: [config] } } }), config).catch(() => {})
    await browser.close()
}
