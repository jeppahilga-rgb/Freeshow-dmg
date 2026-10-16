import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
const video = await fs.readFile('tauri-test-output/capture-detail.mp4')
const server = http.createServer((request, response) => {
    if (request.url === '/video.mp4') { response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': video.length }); response.end(video) }
    else { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<title>FreeShow GPU video capture fixture</title><style>body{margin:0;background:black}video{width:100%;height:100vh}</style><video muted autoplay loop playsinline src="/video.mp4"></video>') }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const app = await chromium.connectOverCDP('http://127.0.0.1:9224')
let main
for (const page of app.contexts()[0].pages()) if (await page.evaluate(() => window.__TAURI_INTERNALS__?.metadata.currentWindow.label) === 'main') main = page
const normal = process.argv.includes('--covered')
const edge = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: false, ...(normal ? { ignoreDefaultArgs: ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] } : {}) })
let cover
try {
    const cdp = await edge.newBrowserCDPSession()
    const system = await cdp.send('SystemInfo.getInfo')
    console.log('Edge GPU status', { compositing: system.gpu.featureStatus.gpu_compositing, videoDecode: system.gpu.featureStatus.video_decode })
    const page = await edge.newPage({ viewport: { width: 960, height: 540 } })
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.waitForFunction(() => document.querySelector('video').currentTime > 0.5)
    const playback = await page.evaluate(() => ({ width: document.querySelector('video').videoWidth, time: document.querySelector('video').currentTime, paused: document.querySelector('video').paused }))
    assert.equal(playback.width, 960); assert.equal(playback.paused, false)
    if (normal) {
        const bounds = await page.evaluate(() => ({ x: screenX, y: screenY, width: outerWidth, height: outerHeight }))
        cover = { id: 'edge-occlusion-probe', bounds, boundsLocked: true, alwaysOnTop: true }
        await main.evaluate(config => window.__TAURI_INTERNALS__.invoke('output_message', { msg: { channel: 'TOGGLE_OUTPUTS', data: { state: true, outputs: [config] } } }), cover)
        await page.waitForTimeout(7000)
    }
    const source = await main.evaluate(async () => (await window.__TAURI_INTERNALS__.invoke('native_sources')).find(s => s.name.includes('FreeShow GPU video capture fixture')))
    assert.ok(source)
    const result = await main.evaluate(async id => {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id } } })
        try {
            const video = document.createElement('video'); video.muted = true; video.srcObject = stream; await video.play(); await new Promise(r => setTimeout(r, 800))
            const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight; const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0)
            const pixels = ctx.getImageData(canvas.width / 4, canvas.height / 3, Math.floor(canvas.width / 2), Math.floor(canvas.height / 2)).data
            let sharp = 0, min = 255, max = 0
            for (let i = 4; i < pixels.length; i += 4) { const change = Math.max(Math.abs(pixels[i] - pixels[i - 4]), Math.abs(pixels[i + 1] - pixels[i - 3]), Math.abs(pixels[i + 2] - pixels[i - 2])); if (change > 100) sharp++; min = Math.min(min, pixels[i]); max = Math.max(max, pixels[i]) }
            return { width: canvas.width, height: canvas.height, sharp, range: max - min }
        } finally { stream.getTracks().forEach(t => t.stop()) }
    }, source.id)
    assert.ok(result.sharp > 500 && result.range > 240, JSON.stringify(result))
    console.log('PASS actual playing local video in Edge retains sharp detail in the captured video area', playback, result)
} finally { if (cover) await main.evaluate(config => window.__TAURI_INTERNALS__.invoke('output_message', { msg: { channel: 'TOGGLE_OUTPUTS', data: { state: false, outputs: [config] } } }), cover).catch(() => {}); await edge.close(); await app.close(); await new Promise(resolve => server.close(resolve)) }
