import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import dgram from 'node:dgram'
import {spawn} from 'node:child_process'
import assert from 'node:assert/strict'
if(process.platform!=='darwin')throw Error('Run MediaMTX smoke test on macOS')
const root=await fs.mkdtemp(path.join(os.tmpdir(),'freeshow-rtmp-ci-'))
const children=[]
async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port}
const rtmp=await freePort(),http=await freePort(),api=await freePort()
const udpSocket=dgram.createSocket('udp4');await new Promise(resolve=>udpSocket.bind(0,'127.0.0.1',resolve));const udp=udpSocket.address().port;udpSocket.close()
let log=''
function start(exe,args){const child=spawn(exe,args,{stdio:['ignore','pipe','pipe']});children.push(child);child.stderr.on('data',bytes=>log+=bytes);child.on('error',error=>log+=error.message);return child}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
try{
 const config=`logLevel: warn
rtsp: false
hls: false
srt: false
moq: false
rtmp: true
rtmpAddress: 127.0.0.1:${rtmp}
webrtc: true
webrtcAddress: 127.0.0.1:${http}
webrtcLocalUDPAddress: 127.0.0.1:${udp}
webrtcAdditionalHosts: [127.0.0.1]
api: true
apiAddress: 127.0.0.1:${api}
paths:
  cam:
    source: publisher
`
 const configPath=path.join(root,'input.yml');await fs.writeFile(configPath,config)
 start(path.resolve('src-tauri/mediamtx/mediamtx-darwin-arm64'),[configPath])
 let ready=false
 for(let i=0;i<60;i++){try{const response=await fetch(`http://127.0.0.1:${api}/v3/paths/list`,{signal:AbortSignal.timeout(500)});if(response.ok){ready=true;break}}catch{}await delay(100)}
 assert.ok(ready,'MediaMTX API must start: '+log.slice(-1000))
 const url=`rtmp://127.0.0.1:${rtmp}/cam`
 start('ffmpeg',['-hide_banner','-loglevel','error','-re','-f','lavfi','-i','testsrc2=size=320x180:rate=15','-t','20','-c:v','libx264','-preset','ultrafast','-tune','zerolatency','-g','15','-keyint_min','15','-sc_threshold','0','-pix_fmt','yuv420p','-f','flv',url])
 let status
 for(let i=0;i<100;i++){try{const response=await fetch(`http://127.0.0.1:${api}/v3/paths/get/cam`,{signal:AbortSignal.timeout(500)});status=await response.json();if(status.ready)break}catch{}await delay(100)}
 assert.ok(status?.ready,'RTMP test publisher must be ready: '+log.slice(-1500))
 assert.ok(status.tracks.some(track=>/h264/i.test(track)),'Expected H264 camera track')
 const decoder=start('ffmpeg',['-hide_banner','-loglevel','error','-analyzeduration','1000000','-probesize','1000000','-i',url,'-frames:v','2','-pix_fmt','rgba','-f','rawvideo','pipe:1'])
 const chunks=[];decoder.stdout.on('data',chunk=>chunks.push(chunk))
 await Promise.race([new Promise((resolve,reject)=>{decoder.on('error',reject);decoder.on('exit',code=>code===0?resolve():reject(Error('Decoder failed: '+log.slice(-1000))))}),delay(12000).then(()=>{throw Error('RTMP decode timed out: '+log.slice(-1500))})])
 const bytes=Buffer.concat(chunks);assert.equal(bytes.length,320*180*4*2);assert.ok(new Set(bytes.subarray(0,320*180*4)).size>20,'Test frame must contain image content')
 console.log('PASS ARM MediaMTX: RTMP publish, camera readiness, H264 track and two decoded colour-pattern frames')
}finally{
 for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')
 await Promise.all(children.map(child=>new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)resolve();else child.once('exit',resolve)})))
 await fs.rm(root,{recursive:true,force:true})
}
