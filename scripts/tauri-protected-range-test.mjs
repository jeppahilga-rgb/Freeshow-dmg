import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {build} from 'esbuild'
const root=await fs.mkdtemp(path.join(os.tmpdir(),'freeshow-protected-test-'));try{
 const compiled=path.join(root,'range.mjs');await build({entryPoints:['src-tauri/backend-runtime/encrypted-media.ts'],outfile:compiled,bundle:true,platform:'node',format:'esm',logLevel:'silent'});const {encryptedRange}=await import('file:///'+compiled.replaceAll('\\','/'));const key=crypto.randomBytes(32)
 for(const length of [1,16,17,127,1024,4194417]){const clear=crypto.randomBytes(length),iv=crypto.randomBytes(16),cipher=crypto.createCipheriv('aes-256-cbc',key,iv),file=path.join(root,'encrypted-'+length);await fs.writeFile(file,Buffer.concat([iv,cipher.update(clear),cipher.final()]));for(const [start,end] of [[0,Math.min(25,length-1)],[Math.floor(length/2),Math.min(length-1,Math.floor(length/2)+37)],[Math.max(0,length-20),length-1]]){const response=await encryptedRange(file,key,`bytes=${start}-${end}`);if(!Buffer.from(response.body,'base64').equals(clear.subarray(start,end+1)))throw Error('CBC range mismatch at '+length)}const suffix=await encryptedRange(file,key,'bytes=-13');if(!Buffer.from(suffix.body,'base64').equals(clear.subarray(Math.max(0,length-13))))throw Error('Suffix mismatch');const invalid=await encryptedRange(file,key,`bytes=${length}-`);if(invalid.status!==416)throw Error('Past-EOF range accepted');const bounded=await encryptedRange(file,key,'bytes=0-');if(Buffer.from(bounded.body,'base64').length>4194304)throw Error('Transport size exceeded');}
 console.log('PASS: CBC block boundaries, suffix requests, past-EOF rejection, and bounded 4 MB responses')
}finally{if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(root).startsWith('freeshow-protected-test-'))throw Error('Unsafe cleanup');await fs.rm(root,{recursive:true,force:true})}
