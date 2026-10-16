import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import {execFileSync} from 'node:child_process'
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Run on a native Apple Silicon macOS runner')
const destination='src-tauri/mac-runtime'
await fs.mkdir(destination,{recursive:true})
const helper=path.join(destination,'freeshow-native')
execFileSync('/usr/bin/xcrun',['swiftc','-parse-as-library','-O','-target','arm64-apple-macosx13.0','src-tauri/macos-native/FreeShowNative.swift','-o',helper],{stdio:'inherit'})
execFileSync('/usr/bin/codesign',['--force','--sign','-',helper],{stdio:'inherit'})
execFileSync(helper,['selftest'],{stdio:'inherit'})
for(const name of ['backend.cjs','nemotronWorker.js','streamReceiverProcess.js','ndiWorker.js','omtWorker.js'])await fs.copyFile(path.join('src-tauri/backend-runtime/build',name),path.join(destination,name))
await fs.cp('src-tauri/backend-runtime/build/proto',path.join(destination,'proto'),{recursive:true})
await fs.copyFile(process.execPath,path.join(destination,'node'));await fs.chmod(path.join(destination,'node'),0o755)
execFileSync('/usr/bin/codesign',['--force','--sign','-',path.join(destination,'node')],{stdio:'inherit'})
for(const [source,name] of [['LICENSE','LICENSE-FreeShow.txt'],['node_modules/svelte/LICENSE.md','LICENSE-Svelte.txt'],['node_modules/dompurify/LICENSE','LICENSE-DOMPurify.txt'],['MACOS-ARM-PORT.md','MACOS-ARM-PORT.md']])await fs.copyFile(source,path.join(destination,name))
const nodeLicense=await fetch(`https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`)
if(!nodeLicense.ok)throw Error('Node runtime license could not be downloaded')
await fs.writeFile(path.join(destination,'LICENSE-Node.txt'),await nodeLicense.text())
// Keep notices for JavaScript packages included in the bundled backend.
const metadata=JSON.parse(await fs.readFile('src-tauri/backend-runtime/build/metafile.json','utf8'))
const packageRoots=new Set(Object.keys(metadata.inputs).map(name=>name.replaceAll('\\','/').match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)(?:\/|$)/)?.[1]).filter(Boolean))
const notices=path.join(destination,'notices');await fs.mkdir(notices,{recursive:true})
const packages=[]
for(const root of [...packageRoots].sort()){
 const info=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'))
 const prefix=(info.name+'-'+info.version).replace(/[^a-zA-Z0-9_.-]/g,'_')+'-'+crypto.createHash('sha256').update(root).digest('hex').slice(0,8)
 const licenses=[]
 for(const entry of await fs.readdir(root,{withFileTypes:true})){
  if(!entry.isFile()||!/^(licen[sc]e|copying|notice)/i.test(entry.name))continue
  const name=prefix+'-'+entry.name;await fs.copyFile(path.join(root,entry.name),path.join(notices,name));licenses.push('notices/'+name)
 }
 packages.push({name:info.name,version:info.version,license:info.license,notices:licenses})
}
await fs.writeFile(path.join(destination,'THIRD-PARTY.json'),JSON.stringify(packages,null,2))
await import('./stage-macos-addons.mjs')
const files={};for(const name of await fs.readdir(destination,{recursive:true})){const file=path.join(destination,name);if(!(await fs.stat(file)).isFile())continue;const bytes=await fs.readFile(file);files[name]={bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}}
await fs.writeFile(path.join(destination,'manifest.json'),JSON.stringify({platform:'darwin',arch:'arm64',node:process.versions.node,corePreview:true,files},null,2))
console.log('Staged Mac core runtime:',Object.keys(files).length,'files')
