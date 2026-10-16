import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {execFileSync} from 'node:child_process'
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('MediaMTX staging requires Apple Silicon macOS')
const url='https://github.com/bluenviron/mediamtx/releases/download/v1.21.2/mediamtx_v1.21.2_darwin_arm64.tar.gz'
const digest='7d0d0c5c11527cbd10bde1c3d728864eb0334a9b653566cd73c0259750cbf093'
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'freeshow-mediamtx-'))
try{
 const response=await fetch(url)
 if(!response.ok)throw Error('MediaMTX download failed: '+response.status)
 const bytes=Buffer.from(await response.arrayBuffer())
 if(crypto.createHash('sha256').update(bytes).digest('hex')!==digest)throw Error('MediaMTX checksum mismatch')
 const archive=path.join(temp,'archive.tar.gz');await fs.writeFile(archive,bytes)
 execFileSync('/usr/bin/tar',['-xzf',archive,'-C',temp,'mediamtx'])
 const target='src-tauri/mediamtx/mediamtx-darwin-arm64'
 await fs.copyFile(path.join(temp,'mediamtx'),target);await fs.chmod(target,0o755)
 execFileSync('/usr/bin/lipo',[target,'-verify_arch','arm64'])
 execFileSync('/usr/bin/codesign',['--force','--sign','-',target])
 execFileSync(target,['--version'],{stdio:'inherit'})
 await fs.writeFile('src-tauri/mediamtx/MAC-UPSTREAM.json',JSON.stringify({version:'v1.21.2',url,digest:'sha256:'+digest},null,2))
}finally{await fs.rm(temp,{recursive:true,force:true})}
