import {chromium} from 'playwright'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),{wsServer:Server}=require('../node_modules/playwright-core/lib/utilsBundle.js')
const hash=x=>createHash('sha256').update(x).digest('base64')
const expected=hash(hash('fixture-password'+'salt')+'challenge'),requests=[]
const server=new Server({host:'127.0.0.1',port:0});await new Promise(r=>server.once('listening',r));const port=server.address().port
server.on('connection',socket=>{socket.send(JSON.stringify({op:0,d:{obsWebSocketVersion:'5.6.0',rpcVersion:1,authentication:{salt:'salt',challenge:'challenge'}}}));socket.on('message',raw=>{const m=JSON.parse(raw);if(m.op===1){if(m.d.authentication!==expected)return socket.close(4009,'Authentication failed');socket.send(JSON.stringify({op:2,d:{negotiatedRpcVersion:1}}))}if(m.op===6){requests.push(m.d.requestType);const data=m.d.requestType==='GetSceneList'?{currentProgramSceneName:'Fixture A',scenes:[{sceneIndex:0,sceneName:'Fixture A'},{sceneIndex:1,sceneName:'Fixture B'}]}:{};socket.send(JSON.stringify({op:7,d:{requestType:m.d.requestType,requestId:m.d.requestId,requestStatus:{result:true,code:100},responseData:data}}))}})})
const b=await chromium.connectOverCDP('http://127.0.0.1:9224');const main=b.contexts()[0].pages().find(p=>p.url().startsWith('http://127.0.0.1:3000'))
try{
 await main.waitForFunction(()=>window.api)
 await main.evaluate(async port=>{const stores=await import('/@fs/C:/Users/User/Documents/ChatGPT/Freeshow/upstream/src/frontend/stores.ts');window.obsOriginal=structuredClone(stores.obsData.get?stores.obsData.get():{});stores.obsData.set({enabled:true,ip:'127.0.0.1',port,password:'fixture-password'});const {default:OBS}=await import('/@fs/C:/Users/User/Documents/ChatGPT/Freeshow/upstream/src/frontend/components/drawer/pages/OBS.svelte');const target=document.createElement('div');target.id='obs-fixture';target.style.cssText='position:fixed;inset:80px;background:#171821;z-index:9999';document.body.append(target);window.obsComponent=new OBS({target,props:{searchValue:''}})},port)
 await main.locator('#obs-fixture').getByText('Connect to OBS Studio',{exact:true}).click()
 await main.locator('#obs-fixture').getByText('Fixture B',{exact:true}).first().waitFor({timeout:15000})
 await main.locator('#obs-fixture').getByText('Fixture B',{exact:true}).first().click();await main.waitForTimeout(300)
 assert.ok(requests.includes('SetCurrentProgramScene'));assert.ok(requests.includes('GetSceneList'))
 console.log('PASS actual OBS panel: password authentication, scene list, scene control')
 const failure=await main.evaluate(async port=>{const {obsData}=await import('/@fs/C:/Users/User/Documents/ChatGPT/Freeshow/upstream/src/frontend/stores.ts');const {connectToOBS}=await import('/@fs/C:/Users/User/Documents/ChatGPT/Freeshow/upstream/src/frontend/utils/obsTalk.ts');obsData.set({ip:'127.0.0.1',port,password:'wrong-password'});const client=await connectToOBS();let message='';client.onStateChange((connected,error)=>message=error||'','test');return {connected:client.isConnected,message}},port)
 assert.equal(failure.connected,false);assert.match(failure.message,/Authentication failed/)
 console.log('PASS wrong password returns a visible authentication error')
}finally{await main.evaluate(async()=>{window.obsComponent?.$destroy();document.getElementById('obs-fixture')?.remove();const {obsData}=await import('/@fs/C:/Users/User/Documents/ChatGPT/Freeshow/upstream/src/frontend/stores.ts');obsData.set(window.obsOriginal||{})}).catch(()=>{});await b.close();for(const client of server.clients)client.close();await new Promise(r=>server.close(r))}

