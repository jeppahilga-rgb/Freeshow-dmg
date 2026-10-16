import {chromium} from 'playwright'
import assert from 'node:assert/strict'
const b=await chromium.connectOverCDP('http://127.0.0.1:9224');let main
for(const p of b.contexts()[0].pages())try{if(await p.evaluate(()=>window.__TAURI_INTERNALS__?.metadata.currentWindow.label)==='main')main=p}catch{}
const result=await main.evaluate(async()=>{
 const saved=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
 const opened=[],tracks=[];let component,target
 try{
  navigator.mediaDevices.getUserMedia=async options=>{const id=options.video.mandatory.chromeMediaSourceId;opened.push(id);const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');x.fillStyle=id==='first'?'#00ff00':'#0000ff';x.fillRect(0,0,320,180);const stream=c.captureStream(15);tracks.push(stream.getVideoTracks()[0]);return stream}
  const {default:Window}=await import('/src/frontend/components/output/Window.svelte')
  target=document.createElement('div');document.body.append(target);component=new Window({target,props:{id:'first'}})
  await new Promise(r=>setTimeout(r,500));component.$set({id:'second'});await new Promise(r=>setTimeout(r,500))
  const v=target.querySelector('video');const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');x.drawImage(v,0,0);const pixel=[...x.getImageData(20,20,1,1).data]
  component.$destroy();component=null
  return {opened,pixel,ended:tracks.every(t=>t.readyState==='ended')}
 }finally{component?.$destroy();target?.remove();navigator.mediaDevices.getUserMedia=saved}
})
assert.deepEqual(result.opened,['first','second']);assert.ok(result.pixel[2]>240);assert.ok(result.ended)
console.log('PASS existing output component changes source and releases both streams',result)
await b.close()
