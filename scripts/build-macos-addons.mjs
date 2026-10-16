import fs from 'node:fs/promises'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Build native modules on Apple Silicon')

// NDI SDK use for this FreeShow build was authorized by the repository owner.
execFileSync(process.execPath,['ndi.js'],{cwd:'node_modules/grandiose',stdio:'inherit'})
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
