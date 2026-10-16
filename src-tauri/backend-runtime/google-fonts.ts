import fs from 'node:fs/promises'
import path from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {app} from './electron'
import catalog from './google-font-catalog.json'
const commit='67bc647ce1910e92f461bcc82aae30f21d21a9cc'
const pending=new Map<string,Promise<any>>()
async function bytes(url:string,max:number){const response=await fetch(url,{signal:AbortSignal.timeout(45000)});if(!response.ok||!response.body)throw Error('Google Font download failed ('+response.status+')');const chunks:Buffer[]=[];let size=0;const reader=response.body.getReader();try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw Error('Google Font download exceeds size limit');chunks.push(Buffer.from(value))}}finally{await reader.cancel()}return Buffer.concat(chunks)}
export async function googleFonts(data:any){
 if(data?.action==='inventory'){
  const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command','Add-Type -AssemblyName System.Drawing; $fonts = New-Object System.Drawing.Text.InstalledFontCollection; try { @($fonts.Families | ForEach-Object { $_.Name }) | ConvertTo-Json -Compress } finally { $fonts.Dispose() }'],{windowsHide:true,timeout:15000,maxBuffer:1024*1024})
  const value=JSON.parse(stdout);return Array.isArray(value)?value:[value]
 }
 if(data?.action!=='download'||typeof data.name!=='string'||!(Object.prototype.hasOwnProperty.call(catalog,data.name)))throw Error('Unknown Google Font family')
 if(pending.has(data.name))return pending.get(data.name)
 const task=download(data.name).finally(()=>pending.delete(data.name));pending.set(data.name,task);return task
}
async function download(name:string){
 const directory=(catalog as Record<string,string>)[name],base=`https://raw.githubusercontent.com/google/fonts/${commit}/${directory}/`
 const root=path.join(app.getPath('userData'),'fonts','google',directory.split('/')[1]);await fs.mkdir(root,{recursive:true})
 const manifestPath=path.join(root,'font.json')
 try{const saved=JSON.parse(await fs.readFile(manifestPath,'utf8'));if(saved.commit===commit&&saved.fonts.length&&await Promise.all(saved.fonts.map((font:any)=>fs.stat(font.path).then(s=>s.size>0).catch(()=>false))).then(results=>results.every(Boolean)))return saved.fonts}catch{}
 const metadata=(await bytes(base+'METADATA.pb',256*1024)).toString('utf8')
 const axis=metadata.match(/axes \{\s*tag: "wght"\s*min_value: ([\d.]+)\s*max_value: ([\d.]+)/)
 const blocks=[...metadata.matchAll(/fonts \{([\s\S]*?)\n\}/g)];if(!blocks.length||blocks.length>40)throw Error('Invalid Google Font metadata')
 const license=await bytes(base+'OFL.txt',256*1024).catch(async()=>bytes(base+'LICENSE.txt',256*1024)).catch(async()=>bytes(base+'UFL.txt',256*1024));await fs.writeFile(path.join(root,'LICENSE.txt'),license)
 const fonts:any[]=[];let total=0
 for(const [,block] of blocks){
  const filename=block.match(/filename: "([^"]+)"/)?.[1],style=block.match(/style: "(normal|italic)"/)?.[1]
  if(!filename||/[\\/]/.test(filename)||! /\.(ttf|otf)$/i.test(filename)||!style)throw Error('Invalid Google Font file')
  const weight=filename.includes('wght')&&axis?`${axis[1]} ${axis[2]}`:block.match(/weight: (\d+)/)?.[1]||'400'
  const font=await bytes(base+encodeURIComponent(filename),64*1024*1024);total+=font.length;if(total>160*1024*1024)throw Error('Font family exceeds size limit')
  if(font.length<12||(font.readUInt32BE(0)!==0x00010000&&font.toString('ascii',0,4)!=='OTTO'))throw Error('Invalid downloaded font')
  const destination=path.join(root,filename),temporary=destination+'.'+crypto.randomUUID()+'.part'
  try{await fs.writeFile(temporary,font);await fs.rename(temporary,destination)}finally{await fs.rm(temporary,{force:true})}
  fonts.push({name,path:destination,type:'local',weight,style})
 }
 await fs.writeFile(manifestPath,JSON.stringify({commit,fonts}));return fonts
}
