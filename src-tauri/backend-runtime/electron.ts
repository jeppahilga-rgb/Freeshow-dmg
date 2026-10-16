import fs from 'node:fs'
import path from 'node:path'
import {fork} from 'node:child_process'
import {EventEmitter} from 'node:events'
const boot=JSON.parse(fs.readFileSync(process.env.FREESHOW_BACKEND_CONFIG!,'utf8'))
export const app=Object.assign(new EventEmitter(),{isPackaged:true,getPath:(name:string)=>boot.paths[name]||boot.appData,getAppPath:()=>process.cwd(),getVersion:()=> '1.6.7-beta.1',getName:()=> 'FreeShow+',getLocale:()=>boot.locale||'en-US',whenReady:()=>Promise.resolve(),isReady:()=>true})
export const shell={openExternal:(url:string)=>(globalThis as any).__fsNative('OPEN_URL',{url}),openPath:(path:string)=>(globalThis as any).__fsNative('SYSTEM_OPEN',{path}),showItemInFolder:(path:string)=>(globalThis as any).__fsNative('SYSTEM_OPEN',{path})}
export const net={fetch:globalThis.fetch.bind(globalThis)}
export const ipcMain=new EventEmitter()
export const screen=Object.assign(new EventEmitter(),{getAllDisplays:()=>boot.displays||[],getPrimaryDisplay:()=>boot.displays?.[0]||{bounds:{x:0,y:0,width:1920,height:1080},workAreaSize:{width:1920,height:1080},scaleFactor:1},getDisplayMatching:()=>screen.getPrimaryDisplay()})
export const dialog={showOpenDialog:async(_parent:any,options:any)=>{const result=await (globalThis as any).__fsNative('OPEN_FILE',options);return {canceled:!result.files?.length,filePaths:result.files||[]}},showSaveDialog:async(_parent:any,options:any)=>({filePath:await (globalThis as any).__fsNative('SAVE_DIALOG',options)})}
export const systemPreferences={getMediaAccessStatus:()=> 'granted'}
export const utilityProcess={fork:(module:string,args:string[]=[])=>{const child:any=fork(module,args,{execPath:process.execPath,env:process.env,windowsHide:true,serialization:'advanced',stdio:['ignore','pipe','pipe','ipc']});child.postMessage=(message:any)=>child.send(message);child.on('message',(message:any)=>{if(message?.type==='host-event')(globalThis as any).__fsEvent(message.channel,message.msg,message.id)});return child}}
export const nativeImage={createFromPath:()=>{throw Error('Images are handled by the native Tauri media service')},createFromBuffer:()=>{throw Error('Images are handled by the native Tauri media service')}}
export class BrowserWindow extends EventEmitter {webContents:any;constructor(_options:any={}){super();this.webContents=Object.assign(new EventEmitter(),{send:(channel:string,msg:any,id?:string)=>(globalThis as any).__fsEvent(channel,msg,id),isDestroyed:()=>false,setWindowOpenHandler:()=>{}})}loadURL(url:string){return shell.openExternal(url)}close(){this.emit('closed')}isDestroyed(){return false}focus(){return (globalThis as any).__fsNative('FOCUS_MAIN',{})}show(){}hide(){}center(){}setAlwaysOnTop(){}getBounds(){return screen.getPrimaryDisplay().bounds}}
export default {app,shell,net,ipcMain,screen,dialog,systemPreferences,utilityProcess,nativeImage,BrowserWindow}
export const protocolHandlers=new Map<string,(request:Request)=>Promise<Response>>()
export const protocol={handle:(scheme:string,fn:any)=>protocolHandlers.set(scheme,fn),isProtocolHandled:async(scheme:string)=>protocolHandlers.has(scheme)}
