import { chromium } from 'playwright'
import { transform } from 'esbuild'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
let source = await fs.readFile('src/frontend/tauri/nativeCapture.ts', 'utf8')
source = source.replace(/import \{ invoke \} from "@tauri-apps\/api\/core"/, 'const invoke = window.fixtureInvoke')
source = source.replace(/export /g, '') + '\nwindow.fixtureCapture = nativeCaptureStream'
const { code } = await transform(source, { loader: 'ts', format: 'iife' })
const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try {
 const page = await browser.newPage()
 await page.goto('about:blank')
 await page.evaluate(() => {
  const frames = [32,224].map(level => { const c=document.createElement('canvas');c.width=2560;c.height=1440;const x=c.getContext('2d');x.fillStyle=`rgb(${level},${level},${level})`;x.fillRect(0,0,c.width,c.height);return Uint8Array.from(atob(c.toDataURL('image/jpeg',.98).split(',')[1]),a=>a.charCodeAt(0)).buffer })
  crypto.randomUUID=()=>"fixture-consumer";window.fixturePolls=0;window.fixtureStops=0
  window.fixtureInvoke=async command => { if(command==='native_capture_frame')return frames[window.fixturePolls++%2];if(command==='native_capture_stop')window.fixtureStops++ }
 })
 await page.addScriptTag({content:code})
 const result = await page.evaluate(async()=>{
  const stream=await window.fixtureCapture('native-window-fixture')
  const video=document.createElement('video');video.muted=true;video.srcObject=stream;document.body.append(video);await video.play()
  let delivered=0;const colors=new Set();const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d')
  const tick=()=>video.requestVideoFrameCallback(()=>{delivered++;x.drawImage(video,0,0,1,1);colors.add(x.getImageData(0,0,1,1).data[0]);if(delivered<100)tick()});tick()
  await new Promise(r=>setTimeout(r,1800))
  const result={width:video.videoWidth,height:video.videoHeight,delivered,colors:[...colors],time:video.currentTime,polls:window.fixturePolls}
  stream.getTracks().forEach(t=>t.stop());await new Promise(r=>setTimeout(r,100));result.stops=window.fixtureStops
  return result
 })
 assert.equal(result.width,2560);assert.equal(result.height,1440);assert.ok(result.delivered>=10);assert.ok(result.colors.length>=2);assert.equal(result.stops,1)
 await fs.writeFile('../output/NATIVE-CAPTURE-PLAYBACK-TEST.json',JSON.stringify(result,null,2))
 console.log('PASS: production canvas stream delivers changing full-resolution frames and releases source',result)
} finally {await browser.close()}

