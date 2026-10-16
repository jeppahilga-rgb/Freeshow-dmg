import fs from 'node:fs/promises'
import path from 'node:path'
import {createRequire} from 'node:module'
import {execFileSync} from 'node:child_process'
const runtime=path.resolve('src-tauri/mac-runtime')
const rootRequire=createRequire(path.resolve('package.json'))
const copied=new Map(),native=[],verified=[]
async function packageRoot(name,requireFrom){
 let entry;try{entry=requireFrom.resolve(name+'/package.json')}catch{entry=requireFrom.resolve(name)}
 let folder=path.dirname(entry)
 for(;;){try{const info=JSON.parse(await fs.readFile(path.join(folder,'package.json'),'utf8'));if(info.name===name)return {folder,info}}catch{}const parent=path.dirname(folder);if(parent===folder)throw Error('Cannot resolve '+name);folder=parent}
}
async function copy(name,requireFrom=rootRequire){
 const {folder,info}=await packageRoot(name,requireFrom)
 const location=path.relative(path.resolve('node_modules'),folder)
 if(location.startsWith('..')||path.isAbsolute(location))throw Error('Dependency resolves outside node_modules: '+name)
 if(copied.has(location))return
 copied.set(location,{name,version:info.version})
 const destination=path.join(runtime,'node_modules',location)
 await fs.cp(folder,destination,{recursive:true,filter:input=>{
  const relative=path.relative(folder,input).replaceAll('\\','/');const pieces=relative.split('/')
  if(pieces.some(part=>['node_modules','.git','test','tests','scratch','examples','obj','obj.target'].includes(part)))return false
  if(relative.startsWith('build/')&&!relative.startsWith('build/Release'))return false
  if(/\.(exe|dll|lib|so|o|a|pdb)$/i.test(input))return false
  return true
 }})
 for(const relative of await fs.readdir(destination,{recursive:true}))if(/\.(node|dylib)$/.test(relative))native.push(path.join(destination,relative))
 const requireFromPackage=createRequire(path.join(folder,'package.json'))
 for(const child of Object.keys(info.dependencies||{}))await copy(child,requireFromPackage)
 if(name==='sherpa-onnx-node')await copy('sherpa-onnx-darwin-arm64',requireFromPackage)
}
for(const name of ['grandiose','openmediatransport','macadam','libltc-wrapper','@discordjs/opus','jazz-midi','sherpa-onnx-node','slideshow'])await copy(name)
// Resolve every non-system dylib beside the staged native modules. No developer-machine paths may remain.
for(let index=0;index<native.length;index++){
 const binary=native[index]
 try{execFileSync('/usr/bin/lipo',[binary,'-verify_arch','arm64'])}catch{
  // Jazz packages include legacy Intel binaries; its arm64 loader selects macosa64.
  if(binary.includes('/jazz-midi/')&&!binary.includes('/macosa64/')){await fs.rm(binary);continue}throw Error('Not ARM64: '+binary)
 }
 verified.push(binary)
 const dependencies=execFileSync('/usr/bin/otool',['-L',binary],{encoding:'utf8'}).split('\n').slice(1).map(line=>line.trim().split(' (')[0]).filter(Boolean)
 for(const dependency of dependencies){
  if(dependency.startsWith('/System/')||dependency.startsWith('/usr/lib/'))continue
  const base=path.basename(dependency)
  let target=path.join(path.dirname(binary),base)
  try{await fs.access(target)}catch{
   if(!path.isAbsolute(dependency))throw Error('Unresolved native dependency '+dependency+' in '+binary)
   await fs.copyFile(dependency,target);native.push(target)
  }
  if(path.resolve(target)===path.resolve(binary))continue
  if(dependency!=='@loader_path/'+base)execFileSync('/usr/bin/install_name_tool',['-change',dependency,'@loader_path/'+base,binary])
 }
 if(binary.endsWith('.dylib'))execFileSync('/usr/bin/install_name_tool',['-id','@loader_path/'+path.basename(binary),binary])
 execFileSync('/usr/bin/codesign',['--force','--sign','-',binary])
}
// Slideshow resolves its AppleScript connectors from the packaged resources directory.
await fs.mkdir(path.join(runtime,'slideshow'),{recursive:true})
for(const file of await fs.readdir('node_modules/slideshow'))if(file.startsWith('connector-mac-'))await fs.copyFile(path.join('node_modules/slideshow',file),path.join(runtime,'slideshow',file))
await fs.writeFile(path.join(runtime,'NATIVE-MODULES.json'),JSON.stringify({platform:'darwin',arch:'arm64',packages:Object.fromEntries(copied),binaries:verified.map(file=>path.relative(runtime,file))},null,2))
console.log('Staged Mac ARM native packages:',copied.size)

execFileSync(path.join(runtime,'node'),['--input-type=module','-e',`for(const name of ['grandiose','openmediatransport','macadam','libltc-wrapper','@discordjs/opus','jazz-midi','sherpa-onnx-node','slideshow']){await import(name);console.log('PASS staged runtime import:',name)}`],{cwd:runtime,stdio:'inherit'})
