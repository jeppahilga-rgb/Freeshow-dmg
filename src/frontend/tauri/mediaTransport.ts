import {deliverStreamFrame} from '../utils/streamPort'
let socket:WebSocket|undefined,current=''
let dispatchBlackmagic:((data:any)=>void)|undefined
export function setBlackmagicDispatch(dispatch:(data:any)=>void){dispatchBlackmagic=dispatch}
export function sendEngineAudio(data:any):boolean{if(!socket||socket.readyState!==WebSocket.OPEN||socket.bufferedAmount>256*1024)return false;const bytes=data.buffer instanceof ArrayBuffer?new Uint8Array(data.buffer):new Uint8Array(data.buffer.buffer,data.buffer.byteOffset,data.buffer.byteLength);const json=new TextEncoder().encode(JSON.stringify({channel:'AUDIO',id:data.id,sampleRate:data.sampleRate,icecast:data.icecast}));const packet=new Uint8Array(4+json.length+bytes.length);new DataView(packet.buffer).setUint32(0,json.length,true);packet.set(json,4);packet.set(bytes,4+json.length);socket.send(packet);return true}
export function connectMediaTransport(url:string){
 const parsed=new URL(url);if(parsed.protocol!=='ws:'||parsed.hostname!=='127.0.0.1')throw Error('Invalid media transport')
 if(current===url&&socket&&socket.readyState<=WebSocket.OPEN)return
 socket?.close();current=url;const connection=new WebSocket(url);socket=connection;connection.binaryType='arraybuffer'
 connection.onmessage=event=>{try{if(!(event.data instanceof ArrayBuffer)||event.data.byteLength<4)return;const bytes=new Uint8Array(event.data),length=new DataView(event.data).getUint32(0,true);if(length>65536||length+4>bytes.length)return;const message=JSON.parse(new TextDecoder().decode(bytes.subarray(4,4+length)));if(message.channel==='BLACKMAGIC_FRAME'){const video=message.data?.frame?.video;if(!video||video.width*video.height*4!==bytes.length-4-length)return;video.data=bytes.subarray(4+length);dispatchBlackmagic?.(message.data);return}const frame=message.args?.data?.frame;if(!frame||!Number.isInteger(frame.xres)||!Number.isInteger(frame.yres)||frame.xres<1||frame.yres<1||frame.xres*frame.yres>4096*2160)return;frame.data=bytes.subarray(4+length);deliverStreamFrame(message.ipcChannel,message.args.data)}finally{if(connection.readyState===WebSocket.OPEN)connection.send('1')}}
 window.addEventListener('pagehide',()=>connection.close(),{once:true})
}
