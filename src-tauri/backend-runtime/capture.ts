import {outputs} from './output-state'
import {updateRtmpEngines,resendOutputFrame,updateEngineRate} from './output-engines'
import {blackmagicFrame} from './index'
export class CaptureHelper {
 static customFramerates:Record<string,Record<string,number>>={}
 static Lifecycle={updateRtmpState:updateRtmpEngines}
 static updateFramerate(id:string){const output=outputs.get(id);if(output&&Object.keys(this.customFramerates[id]||{}).length)output.captureFps=Math.max(1,...Object.values(this.customFramerates[id]));updateEngineRate(id);resendOutputFrame(id)}
}
export class OutputHelper {
 static Send={sendToWindow:(id:string,msg:any,channel:string)=>{if(channel==='BLACKMAGIC'&&msg.channel==='RECEIVE_STREAM')blackmagicFrame(id,msg)}}
 static getAllOutputs(){return [...outputs.values()].map(output=>({...output,window:{isAlwaysOnTop:()=>output.alwaysOnTop!==false,isDestroyed:()=>false,getBounds:()=>output.bounds||{width:1280,height:720}}}))}
 static getKeys(){return [...outputs.keys()]}
 static getOutput(id:string){return outputs.get(id)}
}
