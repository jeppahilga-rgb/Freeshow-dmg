import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { storeFilesData } from './store-metadata'
import { defaultConfig } from '../../src/electron/data/defaults'
const boot=JSON.parse(fs.readFileSync(process.env.FREESHOW_BACKEND_CONFIG!,'utf8'))
const nativeRoot=boot.libraryRoot
const names:Record<string,string>={SETTINGS:'settings_tauri',SYNCED_SETTINGS:'settings_synced',DRIVE_API_KEY:'drive_api_key'}
function protectedBytes(bytes:Buffer,decrypt=false){
 if(process.platform==='darwin'){
  const helper=path.join(path.dirname(process.execPath),'freeshow-native')
  const namespace=crypto.createHash('sha256').update(path.resolve(boot.appData)).digest('hex')
  const output=spawnSync(helper,[decrypt?'unprotect':'protect',namespace],{input:bytes,timeout:30000,maxBuffer:20*1024*1024})
  if(output.status!==0)throw Error('macOS Keychain could not '+(decrypt?'unlock':'protect')+' the credential store. Unlock your login keychain and try again.');return output.stdout
 }
 if(process.platform!=='win32')throw Error('Secure credential storage is unavailable on this platform');
 const script=`Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $result=[Security.Cryptography.ProtectedData]::${decrypt?'Unprotect':'Protect'}($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Convert]::ToBase64String($result))`
 const output=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{input:bytes.toString('base64'),encoding:'utf8',windowsHide:true,timeout:15000})
 if(output.status!==0)throw Error('Windows could not protect the credential store');return Buffer.from(output.stdout.trim(),'base64')
}
class Store {
 path:string;defaults:any;key:string;private cached:any;private mtime=-1
 constructor(key:string,defaults:any){this.key=key;this.defaults=defaults;const root=key==='config'||key==='ACCESS'?boot.appData:boot.hasConfig?path.join(nativeRoot,'Config'):nativeRoot;this.path=path.join(root,(key==='config'?'config':key==='ACCESS'?'access':boot.hasConfig?(names[key]||key.toLowerCase()):key)+'.json')}
 get store(){try{const stat=fs.statSync(this.path);if(stat.mtimeMs!==this.mtime){let bytes=fs.readFileSync(this.path);if(bytes.subarray(0,11).toString()==='FS-DPAPI-1\n'){if(process.platform!=='win32')throw Error('Reconnect accounts on this Mac; Windows credentials cannot be transferred');bytes=protectedBytes(bytes.subarray(11),true)}else if(bytes.subarray(0,14).toString()==='FS-KEYCHAIN-1\n'){if(process.platform!=='darwin')throw Error('Reconnect accounts on this PC; Mac credentials cannot be transferred');bytes=protectedBytes(bytes.subarray(14),true);}this.cached=JSON.parse(bytes.toString());this.mtime=stat.mtimeMs}}catch(error:any){if(error.code!=='ENOENT')throw error;this.cached=structuredClone(this.defaults)}return this.cached||structuredClone(this.defaults)}
 set store(value:any){fs.mkdirSync(path.dirname(this.path),{recursive:true});let bytes=Buffer.from(JSON.stringify(value));if(this.key==='ACCESS')bytes=Buffer.concat([Buffer.from(process.platform==='darwin'?'FS-KEYCHAIN-1\n':'FS-DPAPI-1\n'),protectedBytes(bytes)]);const temp=this.path+'.tmp-'+crypto.randomUUID();fs.writeFileSync(temp,bytes,{mode:0o600});fs.renameSync(temp,this.path);this.cached=value;this.mtime=fs.statSync(this.path).mtimeMs}
 get(key:string){if(this.key==='config'&&key==='dataPath')return nativeRoot;const v=this.store;return key.split('.').reduce((o:any,k)=>o?.[k],v)}
 set(key:string|Record<string,unknown>,value?:any){const current=structuredClone(this.store);if(typeof key!=='string'){if(Object.keys(key).some(k=>['__proto__','constructor','prototype'].includes(k)))throw Error('Invalid setting key');Object.assign(current,key)}else{const parts=key.split('.');if(parts.some(p=>!p||['__proto__','constructor','prototype'].includes(p)))throw Error('Invalid setting key');let target=current;for(const p of parts.slice(0,-1)){if(!p||['__proto__','constructor','prototype'].includes(p))throw Error('Invalid setting key');target=target[p]??={}}target[parts.at(-1)!]=value}this.store=current}
 delete(key:string){const v=structuredClone(this.store);const p=key.split('.');if(p.some(part=>!part||['__proto__','constructor','prototype'].includes(part)))throw Error('Invalid setting key');let target=v;for(const part of p.slice(0,-1))target=target?.[part];if(target)delete target[p.at(-1)!];this.store=v}
 clear(){this.store=structuredClone(this.defaults)}
 has(key:string){return this.get(key)!==undefined}
}
export {storeFilesData}
export const config=new Store('config',defaultConfig)
export const appDataPath=boot.appData
export const _store:any=Object.fromEntries(Object.entries(storeFilesData).map(([k,v]:any)=>[k,new Store(k,v.defaults)]))
export function getStore(id:string){return (id==='config'?config:_store[id])?.store||{}}
export function getStoreValue({file,key}:any){return (file==='config'?config:_store[file])?.get(key)??null}
export function setStoreValue({file,key,value}:any){(file==='config'?config:_store[file])?.set(key,value)}
export function setStore(store:any,value:any){if(store)store.store=value}
export function safeStoreSet(id:string,value:any){if(!_store[id])throw Error('Unknown store');_store[id].store=value;return true}
export function createStores(){return _store}
export async function setupStores(){return _store}
