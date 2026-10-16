import {chromium} from 'playwright'
import assert from 'node:assert/strict'
const b=await chromium.connectOverCDP('http://127.0.0.1:9224');const main=b.contexts()[0].pages().find(p=>/^(http:\/\/127.0.0.1:3000|http:\/\/tauri.localhost)/.test(p.url()))
try{
 const result=await main.evaluate(async()=>new Promise((resolve,reject)=>{
  const socket=new WebSocket('ws://127.0.0.1:4455');const timeout=setTimeout(()=>{socket.close();reject(Error('OBS timed out'))},10000)
  socket.onerror=()=>{clearTimeout(timeout);reject(Error('OBS socket blocked or unavailable'))}
  socket.onmessage=event=>{const m=JSON.parse(event.data);if(m.op===0){if(m.d.authentication){clearTimeout(timeout);socket.close();reject(Error('This read-only test requires the currently unauthenticated local OBS server'));return}socket.send(JSON.stringify({op:1,d:{rpcVersion:1,eventSubscriptions:0}}))}if(m.op===2)socket.send(JSON.stringify({op:6,d:{requestType:'GetSceneList',requestId:'read-only-scene-list'}}));if(m.op===7){clearTimeout(timeout);socket.close();resolve({success:m.d.requestStatus.result,count:m.d.responseData?.scenes?.length||0})}}
 }))
 assert.ok(result.success);assert.ok(result.count>0);console.log('PASS app WebView2 connects to running OBS and reads scenes',result)
}finally{await b.close()}
