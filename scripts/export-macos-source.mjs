import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {createWriteStream} from 'node:fs'
import {createRequire} from 'node:module'
const {ZipFile}=createRequire(import.meta.url)('yazl')
const roots=['src/','public/','config/','scripts/','src-tauri/','tauri-ui/']
const docs=new Set(['LICENSE','.gitignore','README.md','MACOS-ARM-PORT.md','BUNDLED-FONTS.md','UPSTREAM-1.6.7-BETA-PORT.md'])
const candidates=[...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8',maxBuffer:32*1024*1024}).split('\0').filter(Boolean))]
const selected=candidates.filter(name=>
 (roots.some(root=>name.startsWith(root))||docs.has(name)||(!name.includes('/')&&/\.(json|mjs|ts|html|toml|lock)$/.test(name))||name==='.github/workflows/macos-arm64-port-check.yml')&&
 !/(^|\/)(node_modules|target|build|dist|deps|sdk|\.gradle|\.git)(\/|$)/.test(name)&&
 !/\.(exe|dll|node|dylib|so|apk|zip|mp4|pptx|pdf|pem|pfx|p12|key)$/i.test(name)&&
 !/(^|\/)(\.env(?:\..*)?|credentials?[^/]*|secrets?[^/]*|backend-boot\.json)$/i.test(name))
const manifest={target:'aarch64-apple-darwin',repository:'https://github.com/jeppahilga-rgb/Freeshow-dmg',macCompiled:false,uploaded:false,files:{}}
const contents=[]
for(const name of selected.sort()){
 let stat;try{stat=await fs.lstat(name)}catch{continue}
 if(!stat.isFile())continue
 const bytes=await fs.readFile(name)
 if(/\.(ts|js|mjs|cjs|json|rs|md|html|yml|toml|xml)$/i.test(name)&&/(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|github_pat_[A-Za-z0-9_]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[A-Z0-9]{16}|sk-proj-[A-Za-z0-9_-]{40,})/.test(bytes.toString('utf8')))throw Error('Possible credential in '+name+'; source export stopped')
 manifest.files[name]={bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}
 contents.push([name,bytes])
}
const output=path.resolve('../output/FreeShow-Plus-Mac-ARM-Port-Source.zip')
await fs.mkdir(path.dirname(output),{recursive:true})
const zip=new ZipFile(),finished=new Promise((resolve,reject)=>{const stream=createWriteStream(output);stream.on('close',resolve);stream.on('error',reject);zip.on('error',reject);zip.outputStream.pipe(stream)})
for(const [name,bytes] of contents)zip.addBuffer(bytes,name)
zip.addBuffer(Buffer.from(JSON.stringify(manifest,null,2)),'MAC-SOURCE-MANIFEST.json')
zip.end();await finished
const bytes=await fs.readFile(output)
await fs.writeFile(output+'.build.json',JSON.stringify({files:contents.length,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),macCompiled:false,uploaded:false},null,2))
console.log(JSON.stringify({output,files:contents.length,bytes:bytes.length,uploaded:false}))
