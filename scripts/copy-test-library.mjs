import fs from 'node:fs/promises'
import path from 'node:path'
const source='G:/My Drive/Freeshow'
const target=path.resolve('tauri-test-output/drive-library')
await fs.mkdir(path.join(target,'shows'),{recursive:true})
const index={};const missing=[];let websites=0
for(const name of await fs.readdir(path.join(source,'Shows'))) {
    if(!name.endsWith('.show'))continue
    const [id,show]=JSON.parse(await fs.readFile(path.join(source,'Shows',name),'utf8'))
    if(!/^[\w-]+$/.test(id))throw Error('Invalid show ID')
    await fs.writeFile(path.join(target,'shows',id+'.show'),JSON.stringify([id,show]))
    index[id]=Object.fromEntries(['name','category','timestamps','quickAccess','private','locked'].filter(k=>k in show).map(k=>[k,show[k]]))
    for(const slide of Object.values(show.slides||{})) for(const item of slide.items||[]) if(item.type==='web') {
        websites++
        if(item.web?.src?.startsWith('file:')) {
            const file=decodeURIComponent(new URL(item.web.src).pathname).replace(/^\/([A-Za-z]:)/,'$1')
            try {await fs.access(file)}catch {missing.push({show:show.name,file})}
        }
    }
}
await fs.writeFile(path.join(target,'show-index.json'),JSON.stringify(index))
for(const [name,key] of Object.entries({'overlays.json':'OVERLAYS','projects.json':'PROJECTS','settings_synced.json':'SYNCED_SETTINGS','stage.json':'STAGE','templates.json':'TEMPLATES','themes.json':'THEMES'})) {
    await fs.copyFile(path.join(source,'Config',name),path.join(target,key+'.json'))
}
await fs.writeFile(path.join(target,'missing-websites.json'),JSON.stringify(missing,null,2))
console.log(JSON.stringify({target,shows:Object.keys(index).length,websites,missing:missing.length}))
