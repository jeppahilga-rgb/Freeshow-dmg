import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
const config=path.join(process.env.APPDATA,'app.freeshow.tauri.preview','library-location.json')
const backup='tauri-test-output/packaged-location-backup.json'
if(process.argv[2]==='restore'){
    const saved=JSON.parse(await fs.readFile(backup,'utf8'))
    if(saved.content===null)await fs.rm(config,{force:true})
    else await fs.writeFile(config,saved.content)
}else{
    let content=null;try{content=await fs.readFile(config,'utf8')}catch(error){if(error.code!=='ENOENT')throw error}
    await fs.writeFile(backup,JSON.stringify({content}))
    const app=await chromium.connectOverCDP('http://127.0.0.1:9224')
    let main;for(const page of app.contexts()[0].pages())if(await page.evaluate(()=>window.__TAURI_INTERNALS__?.metadata.currentWindow.label)==='main')main=page
    await main.evaluate(root=>window.__TAURI_INTERNALS__.invoke('set_data_folder',{path:root}),path.resolve('tauri-test-output/drive-library'))
    await app.close()
}
