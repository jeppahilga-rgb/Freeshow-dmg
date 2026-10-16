import {mediaTransport,sendMediaPacket,clearWhipFrame} from './media-transport'
import {outputs} from './output-state'
let running=false
let startup:Promise<void>|undefined
const resources=new Map<string,{url:string,token?:string}>()
export class WebRtcHost{
 static isRunning(){return running}
 static async start(){if(running)return;if(!startup)startup=(async()=>{const data=await mediaTransport({target:'whip'});(globalThis as any).__fsEvent('WHIP_HOST',{channel:'BOOT',data});running=true})().finally(()=>{startup=undefined});await startup}
 static stop(){running=false;(globalThis as any).__fsEvent('WHIP_HOST',{channel:'CLOSE'})}
 static sendFrame(outputId:string,buffer:Buffer,size:{width:number;height:number}){if(!running)return;const rgba=Buffer.from(buffer);for(let i=0;i<rgba.length;i+=4){const b=rgba[i];rgba[i]=rgba[i+2];rgba[i+2]=b}sendMediaPacket('whip','WEBRTC_FRAME',{outputId,size},rgba)}
 static sendAudio(buffer:Buffer,options:{sampleRate:number;channelCount:number;outputId?:string}){if(running)sendMediaPacket('whip','WEBRTC_AUDIO',options,buffer)}
 static startWhip(outputId:string,url:string,token?:string,options:any={}){(globalThis as any).__fsEvent('WHIP_HOST',{channel:'START_WHIP',data:{outputId,url,token,fps:options.fps||30,bitrate:options.bitrate||2500}})}
 static stopWhip(outputId:string){clearWhipFrame(outputId);(globalThis as any).__fsEvent('WHIP_HOST',{channel:'STOP_WHIP',data:{outputId}})}
}
export async function whipSignal(data:any){
 if(data.action==='delete'){
  const resource=resources.get(data.outputId)
  if(!resource||data.url!==resource.url)throw Error('Invalid WHIP resource')
  const response=await fetch(resource.url,{method:'DELETE',redirect:'error',headers:resource.token?{Authorization:'Bearer '+resource.token}:{},signal:AbortSignal.timeout(15000)})
  if(!response.ok&&response.status!==404&&response.status!==410)throw Error('WHIP cleanup failed ('+response.status+')')
  resources.delete(data.outputId);return null
 }
 const output=outputs.get(data.outputId)
 if(!output?.webrtcData?.streaming)throw Error('WHIP output is not active')
 const configured=output.webrtcData
 if(data.action!=='post')throw Error('Unknown WHIP signaling action')
 if(data.url!==configured.url||typeof data.sdp!=='string'||data.sdp.length>256*1024)throw Error('Invalid WHIP offer')
 const response=await fetch(configured.url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/sdp',...(configured.token?{Authorization:'Bearer '+configured.token}:{})},body:data.sdp,signal:AbortSignal.timeout(30000)})
 if(!response.ok)throw Error('WHIP server rejected the stream ('+response.status+')')
 const resourceUrl=response.headers.get('Location')?new URL(response.headers.get('Location')!,configured.url).toString():''
 if(resourceUrl&&new URL(resourceUrl).origin!==new URL(configured.url).origin)throw Error('WHIP resource must use the configured server')
 if(resourceUrl)resources.set(data.outputId,{url:resourceUrl,token:configured.token})
 const reader=response.body?.getReader();let length=0;const chunks:Buffer[]=[]
 if(reader)try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>256*1024)throw Error('WHIP answer is too large');chunks.push(Buffer.from(value))}}finally{await reader.cancel()}
 return {outputId:data.outputId,answerSdp:Buffer.concat(chunks).toString('utf8'),resourceUrl}
}
