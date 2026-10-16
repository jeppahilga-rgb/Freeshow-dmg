import {tauriProtectedEntries,tauriDeriveKey} from '../../src/electron/data/protected'
import {ContentProviderFactory} from '../../src/electron/contentProviders/base/ContentProvider'
import {encryptedRange} from './encrypted-media'
const keys=new Map<string,{secret:string,key:Buffer}>()
export async function serveProtected(data:any){
 const id=String(data.id||'');if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id))throw Error('Invalid protected media ID')
 try{const entry=tauriProtectedEntries.get(id);if(!entry)throw Error('Unknown protected media');const secret=entry.encryptionKey||ContentProviderFactory.getProvider(entry.providerId)?.getEncryptionKey?.();if(!secret)throw Error('No provider encryption key');let cached=keys.get(id);if(!cached||cached.secret!==secret){cached={secret,key:await tauriDeriveKey(secret)};if(keys.size>=32)keys.delete(keys.keys().next().value!);keys.set(id,cached)}return await encryptedRange(entry.filePath,cached.key,String(data.range||''),data.method==='HEAD'?'HEAD':'GET',entry.mimeType)}catch{return {status:500,headers:{'cache-control':'no-store'},body:''}}
}
