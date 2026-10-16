import fs from 'node:fs/promises'
import vm from 'node:vm'
import assert from 'node:assert/strict'
const html=await fs.readFile('src-tauri/backend-runtime/whip-host.html','utf8')
const context=vm.createContext({console:{log(){},info(){},warn(){},error(){}},window:{addEventListener(){}},parent:{location:{origin:'http://localhost'},postMessage(){}},ArrayBuffer,Int16Array,Float32Array,Uint8Array,setTimeout,clearTimeout,setInterval,clearInterval})
vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context)
vm.runInContext(`globalThis.received=[];globalThis.sources=[];streams.test={nextPlayTime:0,audioDest:{},audioCtx:{state:'running',currentTime:1,createBuffer:(channels,frames,rate)=>({duration:frames/rate,copyToChannel:(data,index)=>received.push({index,data:Array.from(data)})}),createBufferSource:()=>{const source={connect(){},disconnect(){this.disconnected=true},start(time){this.time=time}};sources.push(source);return source}}};globalThis.audio= data=>listeners.get('WEBRTC_AUDIO')(null,{outputId:'test',sampleRate:48000,...data});`,context)
context.samples=new Int16Array([16384,-16384,8192])
vm.runInContext('audio({buffer:new Uint8Array(samples.buffer),channelCount:1})',context)
assert.deepEqual(Array.from(context.received[0].data),[0.5,-0.5,0.25])
assert.deepEqual(Array.from(context.received[1].data),[0.5,-0.5,0.25])
vm.runInContext('sources[0].onended()',context)
assert.equal(context.sources[0].disconnected,true)
context.samples=new Int16Array([16384,-8192,8192,-16384])
vm.runInContext('received.length=0;audio({buffer:new Uint8Array(samples.buffer),channelCount:2})',context)
assert.deepEqual(Array.from(context.received[0].data),[0.5,0.25])
assert.deepEqual(Array.from(context.received[1].data),[-0.25,-0.5])
const count=context.sources.length
vm.runInContext('streams.test.nextPlayTime=2;audio({buffer:new Uint8Array(samples.buffer),channelCount:2})',context)
assert.equal(context.sources.length,count,'backlog must not grow')
vm.runInContext('streams.test.nextPlayTime=0;audio({buffer:new Uint8Array(3),channelCount:1});audio({buffer:new Uint8Array(samples.buffer),channelCount:0});audio({buffer:new Uint8Array(samples.buffer),channelCount:2,sampleRate:0});audio({buffer:new Uint8Array(6),channelCount:2})',context)
assert.equal(context.sources.length,count,'malformed PCM must be rejected')
console.log('PASS: WHIP mono/stereo PCM, completed-source cleanup, queue bound, malformed input')
