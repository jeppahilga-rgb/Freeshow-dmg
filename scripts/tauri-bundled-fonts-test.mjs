import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
const manifest=JSON.parse(await fs.readFile('public/fonts/google/manifest.json','utf8'))
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try{
 const page=await browser.newPage(),external=[],failures=[]
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(url.hostname))return route.continue();external.push(url.href);return route.abort()})
 await page.route('**/font-fixture',route=>route.fulfill({contentType:'text/html',body:'<link rel="stylesheet" href="/global.css"><div id="fixture"></div>'}))
 await page.addInitScript(()=>{window.api={send(){},receive(){},removeListener(){}};window.queryLocalFonts=async()=>{throw Error('Local font permission denied in offline fixture')}})
 page.on('requestfailed',request=>{if(request.url().includes('/fonts/google/'))failures.push(request.url())})
 await page.goto('http://127.0.0.1:3000/font-fixture')
 const loaded=await page.evaluate(async records=>{
  await document.fonts.ready
  const loaded=[]
  for(const face of records){const weight=face.weight.split(' ')[0];const spec=`${face.style} ${weight} 32px "${face.family}"`;const matches=await document.fonts.load(spec,'FreeShow ABC 123');if(!matches.length)throw Error('No font face loaded: '+spec);loaded.push(spec)}
  const alias=await document.fonts.load('600 32px "Darker Grotesque SemiBold"')
  if(!alias.length)throw Error('PPTX semibold alias missing')
  await import('/src/frontend/App.svelte')
  const fonts=await import('/src/frontend/components/helpers/fonts.ts')
  if(!await fonts.loadCustomFont({name:'Montserrat',type:'google'}))throw Error('Google font loader did not use embedded font')
  const choices=await fonts.getSystemFontsList()
  for(const family of [...new Set(records.map(face=>face.family))])if(!choices.some(option=>option.label===family))throw Error('Missing offline font choice: '+family)
  return {faces:loaded.length,alias:true,fontChoices:choices.length}
 },manifest.records)
 assert.deepEqual(failures,[])
 assert.ok(!external.some(url=>url.includes('fonts.googleapis.com')||url.includes('fonts.gstatic.com')),'Bundled fonts requested Google servers')
 const downloads=[]
 await page.exposeFunction('fontFixtureInvoke',async(command,args)=>{
  if(command==='backend_service'&&args.operation==='GOOGLE_FONTS'){
   if(args.data.action==='inventory')return ['Arial']
   downloads.push(args.data.name);throw Error('Offline download fixture')
  }
  return null
 })
 const promptResult=await page.evaluate(async()=>{
  window.__TAURI_INTERNALS__={invoke:(command,args)=>window.fontFixtureInvoke(command,args)}
  const stores=await import('/src/frontend/stores.ts'),{resolveImportedFonts}=await import('/src/frontend/components/helpers/importFonts.ts')
  const show={settings:{customFonts:[]},slides:{one:{items:[{style:'font-family: Rubik, Calibri;'}]}}}
  const read=store=>{let result;store.subscribe(value=>result=value)();return result}
  const waitPrompt=async()=>{for(let i=0;i<100;i++){if(read(stores.activePopup)==='confirm')return read(stores.popupData);await new Promise(resolve=>setTimeout(resolve,20))}throw Error('Missing import font confirmation')}
  const cancelled=resolveImportedFonts([show]);const prompt=await waitPrompt();if(!prompt.prompt.includes('Rubik')||!prompt.prompt.includes('Download'))throw Error('Prompt did not name missing font')
  stores.popupData.set({...prompt,id:'confirm',value:false});const cancelledWarnings=await cancelled
  const failed=resolveImportedFonts([show]);const second=await waitPrompt();stores.popupData.set({...second,id:'confirm',value:true});const failedWarnings=await failed
  const unavailable=await resolveImportedFonts([{settings:{},slides:{one:{items:[{style:'font-family: Unlisted Presentation Font, Arial;'}]}}}])
  const available=await resolveImportedFonts([{settings:{},slides:{one:{items:[{style:'font-family: Arial;'}, {style:'font-family: Inter;'}]}}}])
  if(!cancelledWarnings.some(text=>text.includes('not downloaded'))||!failedWarnings.some(text=>text.includes('Could not download Rubik'))||!unavailable.some(text=>text.includes('Install these missing fonts'))||available.length)throw Error('Import font choices/errors are incorrect')
  return {cancelled:true,downloadErrorReported:true,nonGoogleWarning:true,availableFontsSkipped:true}
 })
 assert.deepEqual(downloads,['Rubik'],'download must only happen after explicit acceptance')
 console.log('PASS: offline bundled font faces, PPTX alias, Google loader and picker without local-font permission',JSON.stringify(loaded))
 console.log('PASS: missing font prompt, decline, download error, non-Google warning and installed/bundled detection',JSON.stringify(promptResult))
 await fs.writeFile('../output/bundled-fonts-verification.json',JSON.stringify({loaded,promptResult,fontFailures:failures,googleRequests:external.filter(url=>/fonts\.(googleapis|gstatic)\.com/.test(url))},null,2))
}finally{await browser.close()}

