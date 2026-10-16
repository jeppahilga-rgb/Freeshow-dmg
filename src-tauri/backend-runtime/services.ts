import {requestToMain} from './ipc'
import {shell} from './electron'
export const openURL=(url:string)=>shell.openExternal(url)
export const createLog=(err:any)=>({message:String(err?.message||err).slice(0,1024),date:Date.now()})
export const logError=(err:any)=>(globalThis as any).__fsEvent('MAIN',{channel:'LOG_ERROR',data:createLog(err)})
export const catchErrors=(fn:any)=>{try{return fn()}catch(e){logError(e)}}
export function filePathHashCode(text:string){let value=0;for(const c of text)value=((value<<5)-value+c.charCodeAt(0))|0;return String(value)}
export const getThumbnail=async(data:any)=>({...data,output:await requestToMain('API',{action:'get_thumbnail',data:{path:data.input}})})
export const createThumbnail=async(input:string,size=250)=>(await getThumbnail({input,size})).output
export const getThumbnailFolderPath=()=>process.env.FREESHOW_BACKEND_CACHE||''
export const doesMediaExist=async({path}:any)=>({path,exists:(await import('node:fs')).existsSync(path)})
