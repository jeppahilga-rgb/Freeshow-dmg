import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
const commit='67bc647ce1910e92f461bcc82aae30f21d21a9cc'
const families=['roboto','opensans','montserrat','lato','poppins','notosans','archivo','darkergrotesque','hankengrotesk','inter','raleway','redhatmono','vt323']
const root='public/fonts/google'
const records=[]
const weights={Thin:100,ExtraLight:200,Light:300,Regular:400,Medium:500,SemiBold:600,Bold:700,ExtraBold:800,Black:900}
async function fetchBytes(url){let failure;for(let attempt=0;attempt<3;attempt++){try{const response=await fetch(url,{signal:AbortSignal.timeout(45000)});if(!response.ok)throw Error(`${response.status}: ${url}`);return Buffer.from(await response.arrayBuffer())}catch(error){failure=error}}throw failure}
for(const folder of families){
 const base=`https://raw.githubusercontent.com/google/fonts/${commit}/ofl/${folder}/`
 const metadata=(await fetchBytes(base+'METADATA.pb')).toString()
 const family=metadata.match(/^name: "([^"]+)"/m)[1]
 const directory=path.join(root,folder);await fs.mkdir(directory,{recursive:true})
 await fs.writeFile(path.join(directory,'OFL.txt'),await fetchBytes(base+'OFL.txt'))
 const faces=[...metadata.matchAll(/fonts \{([\s\S]*?)\n\}/g)]
 const axis=metadata.match(/axes \{\s*tag: "wght"\s*min_value: ([\d.]+)\s*max_value: ([\d.]+)/)
 for(const [,block] of faces){
  const file=block.match(/filename: "([^"]+)"/)[1]
  const style=block.match(/style: "([^"]+)"/)[1]
  const weight=file.includes('wght')&&axis?`${axis[1]} ${axis[2]}`:String(block.match(/weight: (\d+)/)?.[1]||weights[file.match(/-([A-Za-z]+)\./)?.[1]]||400)
  const bytes=await fs.readFile(path.join(directory,file)).catch(()=>fetchBytes(base+encodeURIComponent(file)))
  if(bytes.readUInt32BE(0)!==0x00010000&&bytes.toString('ascii',0,4)!=='OTTO')throw Error('Invalid font '+file)
  await fs.writeFile(path.join(directory,file),bytes)
  records.push({family,style,weight,file:`${folder}/${file}`,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')})
 }
 console.log('Bundled',family,faces.length,'faces')
}
const aliases=[{family:'Darker Grotesque SemiBold',source:'Darker Grotesque',weight:'600'}]
const cssFace=r=>`@font-face { font-family: ${JSON.stringify(r.family)}; src: url(${JSON.stringify('./'+r.file)}) format('truetype'); font-style: ${r.style}; font-weight: ${r.weight}; font-display: block; }`
await fs.writeFile(path.join(root,'fonts.css'),[...records.map(cssFace),...aliases.map(a=>cssFace({...records.find(r=>r.family===a.source&&r.style==='normal'),family:a.family,weight:a.weight}))].join('\n')+'\n')
await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify({repository:'https://github.com/google/fonts',commit,records,aliases},null,2))
await fs.writeFile('src/frontend/utils/bundledFonts.ts',`// Generated from the pinned Google Fonts manifest. Assets and OFL licenses ship locally.\nexport const bundledFontNames = ${JSON.stringify([...new Set(records.map(r=>r.family)),...aliases.map(a=>a.family)])} as const\nexport function isBundledFont(name: string) { return bundledFontNames.some(family => family.toLowerCase() === name.trim().replace(/^['"]|['"]$/g, '').toLowerCase()) }\n`)
console.log('Total bytes',records.reduce((sum,r)=>sum+r.bytes,0))
