import {chromium} from 'playwright'
import assert from 'node:assert/strict'
const app=await chromium.connectOverCDP('http://127.0.0.1:9224')
let main
for(const p of app.contexts()[0].pages())try{if(await p.evaluate(()=>window.__TAURI_INTERNALS__?.metadata.currentWindow.label)==='main')main=p}catch{}
const edge=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:false,ignoreDefaultArgs:['--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']})
let cover
try{
 const page=await edge.newPage({viewport:{width:960,height:540}})
 await page.goto(process.argv[2] || 'https://www.youtube.com/watch?v=gNwnOf75N8A',{waitUntil:'domcontentloaded',timeout:60000})
 await page.waitForTimeout(12000)
 await page.locator('video').first().evaluate(async video=>{video.muted=true;await Promise.race([video.play(),new Promise(resolve=>setTimeout(resolve,10000))])})
 await page.waitForFunction(()=>document.querySelector('video')?.videoWidth>0 && document.querySelector('video')?.currentTime>0,{},{timeout:40000}).catch(()=>{})
 const playback=await page.locator('video').first().evaluate(video=>({width:video.videoWidth,time:video.currentTime,paused:video.paused,readyState:video.readyState,error:video.error?.message,source:video.currentSrc}))
 await page.screenshot({path:'tauri-test-output/edge-playing-youtube.png'})
 console.log('Actual playback state',playback)
 assert.ok(playback.width>0 && playback.time>0 && !playback.paused,'YouTube must actually be playing')
 const bounds=await page.evaluate(()=>({x:screenX,y:screenY,width:outerWidth,height:outerHeight}))
 cover={id:'youtube-occlusion-probe',bounds,boundsLocked:true,alwaysOnTop:true}
 await main.evaluate(config=>window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'TOGGLE_OUTPUTS',data:{state:true,outputs:[config]}}}),cover)
 await page.waitForTimeout(7000)
 const title=await page.title()
 const sources=await main.evaluate(()=>window.__TAURI_INTERNALS__.invoke('native_sources'))
 const source=sources.find(s=>s.name.includes(title.replace(/ - YouTube$/,'')))
 assert.ok(source,`Own Edge window is listed: ${title}`)
 const frame=await main.evaluate(async id=>{
  const stream=await navigator.mediaDevices.getUserMedia({video:{mandatory:{chromeMediaSource:'desktop',chromeMediaSourceId:id}}})
  try{const v=document.createElement('video');v.muted=true;v.srcObject=stream;await v.play();await new Promise(r=>setTimeout(r,1500));const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;const x=c.getContext('2d');x.drawImage(v,0,0);const pixels=x.getImageData(0,0,c.width,c.height).data;let min=255,max=0;for(let n=0;n<pixels.length;n+=400){min=Math.min(min,pixels[n]);max=Math.max(max,pixels[n])}return {width:c.width,height:c.height,min,max,png:c.toDataURL()}}finally{stream.getTracks().forEach(t=>t.stop())}
 },source.id)
 assert.ok(frame.width>600 && frame.max-frame.min>100)
 const {default:fs}=await import('node:fs/promises');await fs.writeFile('tauri-test-output/edge-captured-youtube.png',Buffer.from(frame.png.split(',')[1],'base64'));delete frame.png
 console.log('Playing video and captured page; visual comparison required',playback,frame)
}finally{if(cover)await main.evaluate(config=>window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'TOGGLE_OUTPUTS',data:{state:false,outputs:[config]}}}),cover).catch(()=>{});await edge.close();await app.close()}
