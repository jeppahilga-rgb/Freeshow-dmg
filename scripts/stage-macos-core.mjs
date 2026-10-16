import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import {execFileSync} from 'node:child_process'
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Run on a native Apple Silicon macOS runner')
const destination='src-tauri/mac-runtime'
await fs.mkdir(destination,{recursive:true})
for(const name of ['backend.cjs','nemotronWorker.js','streamReceiverProcess.js','ndiWorker.js','omtWorker.js'])await fs.copyFile(path.join('src-tauri/backend-runtime/build',name),path.join(destination,name))
await fs.cp('src-tauri/backend-runtime/build/proto',path.join(destination,'proto'),{recursive:true})
await fs.copyFile(process.execPath,path.join(destination,'node'));await fs.chmod(path.join(destination,'node'),0o755)
execFileSync('/usr/bin/codesign',['--force','--sign','-',path.join(destination,'node')],{stdio:'inherit'})
for(const [source,name] of [['LICENSE','LICENSE-FreeShow.txt'],['node_modules/svelte/LICENSE.md','LICENSE-Svelte.txt'],['node_modules/dompurify/LICENSE','LICENSE-DOMPurify.txt'],['MACOS-ARM-PORT.md','MACOS-ARM-PORT.md']])await fs.copyFile(source,path.join(destination,name))
const nodeLicense=await fetch(`https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`)
if(!nodeLicense.ok)throw Error('Node runtime license could not be downloaded')
await fs.writeFile(path.join(destination,'LICENSE-Node.txt'),await nodeLicense.text())
const files={};for(const name of await fs.readdir(destination,{recursive:true})){const file=path.join(destination,name);if(!(await fs.stat(file)).isFile())continue;const bytes=await fs.readFile(file);files[name]={bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}}
await fs.writeFile(path.join(destination,'manifest.json'),JSON.stringify({platform:'darwin',arch:'arm64',node:process.versions.node,corePreview:true,files},null,2))
console.log('Staged Mac core runtime:',Object.keys(files).length,'files')
