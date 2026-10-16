import fs from 'node:fs/promises'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Build native modules on Apple Silicon')

// NDI SDK use for this FreeShow build was authorized by the repository owner.
const ndiFile='node_modules/grandiose/ndi.js'
let ndiSource=await fs.readFile(ndiFile,'utf8')
const noticePoint='shell.cp(path.join(dir1, "NDI SDK for Apple/lib/macOS/libndi.dylib"), "ndi/lib/mac-x64/")'
if(!ndiSource.includes(noticePoint))throw Error('NDI SDK extraction script changed; review its notices before packaging')
ndiSource=ndiSource.replace(noticePoint,noticePoint+`
        shell.mkdir("-p","ndi/notices")
        for(const file of await fs.promises.readdir(dir1,{recursive:true})){
          if(!/(license|copyright|notice|eula)/i.test(file))continue
          const input=path.join(dir1,file);if(!(await fs.promises.stat(input)).isFile())continue
          await fs.promises.copyFile(input,path.join("ndi/notices",file.replace(/[^a-zA-Z0-9_.-]/g,"_")))
        }`)
const patched='node_modules/grandiose/freeshow-ndi.mjs';await fs.writeFile(patched,ndiSource)
try{execFileSync(process.execPath,['freeshow-ndi.mjs'],{cwd:'node_modules/grandiose',stdio:'inherit'})}finally{await fs.rm(patched,{force:true})}
for(const name of ['grandiose','openmediatransport','macadam','libltc-wrapper']){
 console.log('Building Mac ARM native module:',name)
 execFileSync('/usr/bin/env',['npm','exec','--yes','--package=node-gyp@11.5.0','--','node-gyp','rebuild','--directory',path.resolve('node_modules',name)],{stdio:'inherit'})
}
execFileSync('/usr/bin/env',['npm','rebuild','@discordjs/opus'],{stdio:'inherit'})
const modules=['grandiose','openmediatransport','macadam','libltc-wrapper','@discordjs/opus','jazz-midi','sherpa-onnx-node','slideshow']
for(const name of modules){
 try{await import(name);console.log('PASS native module import:',name)}catch(error){throw Error(name+': '+error.message)}
}
await fs.writeFile('mac-native-modules.json',JSON.stringify({platform:process.platform,arch:process.arch,node:process.versions.node,modules},null,2))
