import html from '../../../src-tauri/backend-runtime/whip-host.html?raw'
import {backendService} from './backendServices'
let iframe:HTMLIFrameElement|undefined,ready=false;const pending:any[]=[]
export function handleWhipHost(message:any){
 if(message.channel==='CLOSE'){iframe?.remove();iframe=undefined;ready=false;pending.length=0;return}
 if(message.channel==='BOOT'){if(iframe)return;iframe=document.createElement('iframe');iframe.title='FreeShow streaming engine';iframe.style.cssText='position:fixed;left:-10px;top:-10px;width:1px;height:1px;border:0;opacity:0;pointer-events:none';iframe.srcdoc=html;document.body.append(iframe);iframe.onload=()=>{ready=true;iframe!.contentWindow!.postMessage({channel:'CONNECT',data:message.data},location.origin);for(const value of pending.splice(0))iframe!.contentWindow!.postMessage(value,location.origin)};return}
 if(!ready){pending.push(message);return}iframe?.contentWindow?.postMessage(message,location.origin)
}
if(typeof window!=='undefined')window.addEventListener('message',async event=>{if(event.source!==iframe?.contentWindow||event.data?.kind!=='FREESHOW_WHIP_SIGNAL')return;const {channel,data}=event.data;if(channel==='WEBRTC_LOG')return;try{const result=await backendService('WHIP_SIGNAL',{...data,action:channel==='DO_WHIP_POST'?'post':'delete'});if(result)iframe?.contentWindow?.postMessage({channel:'WHIP_POST_RESPONSE',data:result},location.origin)}catch(error){iframe?.contentWindow?.postMessage({channel:'WHIP_POST_ERROR',data:{outputId:data.outputId,error:String(error)}},location.origin)}})
