import { invoke } from '@tauri-apps/api/core'
import commands from '../../../src-tauri/backend-runtime/commands.json'
export const backendCommands = new Set(commands)
function encode(value: any): any {
    if(value instanceof ArrayBuffer||ArrayBuffer.isView(value)){const bytes=value instanceof ArrayBuffer?new Uint8Array(value):new Uint8Array(value.buffer,value.byteOffset,value.byteLength);let text='';for(let n=0;n<bytes.length;n+=8192)text+=String.fromCharCode(...bytes.subarray(n,n+8192));return {__fsBytes:btoa(text)}}
    if(Array.isArray(value))return value.map(encode)
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]))
    return value
}
export function decodeBackend(value: any): any {
    if(value?.__fsBytes){const text=atob(value.__fsBytes),bytes=new Uint8Array(text.length);for(let n=0;n<text.length;n++)bytes[n]=text.charCodeAt(n);return bytes}
    if(Array.isArray(value))return value.map(decodeBackend)
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decodeBackend(v)]))
    return value
}
export async function backendService(operation: string, data: any=null){return decodeBackend(await invoke('backend_service',{operation,data:encode(data)}))}
