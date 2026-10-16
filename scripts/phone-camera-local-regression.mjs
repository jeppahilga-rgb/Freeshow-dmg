import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try {
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true})
 const phoneQueue=[],receiverQueue=[]
 await context.exposeBinding('cameraSignal',async(source,command,args)=>{
  if(command==='phone_camera_start')return {id:'phone-test',urls:[]}
  if(command==='phone_camera_signal'){
   if(args.message)phoneQueue.push({...args.message,key:args.key})
   return args.message?[]:receiverQueue.splice(0)
  }
  throw Error(command)
 })
 await context.route('**/phone-fixture*',route=>route.fulfill({contentType:'text/html',body: '<div id="fixture"></div>'}))
 const html=await fs.readFile('src-tauri/src/phone.html','utf8')
 await context.route('**/phone-sender*',route=>route.fulfill({contentType:'text/html',body:html}))
 await context.route('**/poll?*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(phoneQueue.splice(0))}))
 await context.route('**/signal?*',route=>{receiverQueue.push(route.request().postDataJSON());return route.fulfill({contentType:'application/json',body:'{}'})})
 await context.addInitScript(()=>{
  window.wakeRequests=0;window.wakeReleases=0;Object.defineProperty(navigator,'wakeLock',{value:{request:async()=>{window.wakeRequests++;return {released:false,release:async()=>{window.wakeReleases++}}}}});
  window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'}},invoke:(command,args)=>window.cameraSignal(command,args)}
  navigator.mediaDevices.getUserMedia=async()=>{
   const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180
   const ctx=canvas.getContext('2d');setInterval(()=>{ctx.fillStyle='rgb(20,190,70)';ctx.fillRect(0,0,320,180)},30)
   return canvas.captureStream(30)
  }
  RTCRtpSender.prototype.setParameters=async()=>{throw new DOMException('Unsupported optional setting','NotSupportedError')}
 })
 const phone=await context.newPage(),receiver=await context.newPage()
 await phone.goto('http://127.0.0.1:3000/phone-sender?token=phone-test')
 await receiver.goto('http://127.0.0.1:3000/phone-fixture')
 await phone.locator('#orientation').selectOption('landscape');assert.equal(await phone.locator('#view').evaluate(view=>view.classList.contains('portrait')),false);await phone.locator('#orientation').selectOption('portrait');assert.equal(await phone.locator('#view').evaluate(view=>view.classList.contains('portrait')),true);assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await fs.mkdir('../output/phone-ui',{recursive:true});await phone.screenshot({path:'../output/phone-ui/portrait.png',fullPage:true});await phone.setViewportSize({width:844,height:390});await phone.locator('#orientation').selectOption('landscape');assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await phone.screenshot({path:'../output/phone-ui/landscape.png',fullPage:true});await phone.getByRole('button',{name:'Start camera',exact:true}).click()
 const pixels=await receiver.evaluate(async()=>{
  const {phoneCameraStream}=await import('/src/frontend/tauri/phoneCamera.ts')
  const stream=await phoneCameraStream('phone-test')
  const video=document.createElement('video');video.muted=true;video.srcObject=stream;await video.play()
  await new Promise(resolve=>setTimeout(resolve,500))
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180
  const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0,320,180)
  const pixel=[...ctx.getImageData(100,100,1,1).data]
  stream.getTracks().forEach(track=>track.stop());return pixel
 })
 assert.ok(Math.abs(pixels[1]-190)<10,JSON.stringify(pixels))
 await receiver.evaluate(async()=>{
  const {default:Cam}=await import('/src/frontend/components/drawer/live/Cam.svelte')
  window.phoneCard=new Cam({target:document.querySelector('#fixture'),props:{cam:{id:'phone-test',name:'Phone test',group:''}}})
 })
 await receiver.waitForFunction(()=>{const video=document.querySelector('#fixture video');return video&&video.readyState>=2&&!video.paused},{},{timeout:20000})
 await receiver.locator('#fixture').hover()
 await receiver.mouse.move(0,0)
 await receiver.waitForTimeout(2000)
 assert.equal(await receiver.locator('#fixture video').first().evaluate(video=>video.paused),false)
 await receiver.evaluate(()=>window.phoneCard.$destroy())
 await phone.getByRole('button',{name:'Stop',exact:true}).click();await phone.waitForFunction(()=>window.wakeReleases>0);assert(await phone.evaluate(()=>window.wakeRequests>0));console.log('PASS: screen wake lock acquired during camera use and released on Stop');
 console.log('PASS: actual phone card starts without hover and remains live after mouse leave')
 console.log('PASS: phone sender -> FreeShow receiver live pixels, including rejected optional quality settings',pixels)
} finally {await browser.close()}
