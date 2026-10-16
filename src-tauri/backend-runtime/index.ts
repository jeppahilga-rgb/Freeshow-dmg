import {BrowserWindow} from './electron'
import {sendMediaPacket} from './media-transport'
export const isProd=true,isWindows=true,isMac=false,isLinux=false,hardwareAccelerationDisabled=false
export const mainWindow=new BrowserWindow()
export const getMainWindow=()=>mainWindow
export function blackmagicFrame(target:string,msg:any){const frame=msg.data?.frame;if(!frame?.video?.data)return;sendMediaPacket(target,'BLACKMAGIC_FRAME',{...msg.data,frame:{video:{...frame.video,data:undefined}}},Buffer.from(frame.video.data))}
export const toApp=(channel:string,msg:any,id?:string)=>channel==='BLACKMAGIC'&&msg.channel==='RECEIVE_STREAM'?blackmagicFrame('app',msg):(globalThis as any).__fsEvent(channel,msg,id)
export const setAutoProfile=(..._args:any[])=>{}
export const setGlobalMenu=(..._args:any[])=>{}
