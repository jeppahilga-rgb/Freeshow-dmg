import {chromium} from 'playwright'
import assert from 'node:assert/strict'
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try{
 const page=await browser.newPage(),errors=[]
 page.on('pageerror',e=>errors.push(e.message))
 await page.route('**/lyrics-fixture',r=>r.fulfill({contentType:'text/html',body:'<div id="fixture"></div>'}))
 await page.addInitScript(()=>{
  const listeners=new Map();window.attempts=0;window.chosen=null;
  window.api={receive:(channel,cb,id)=>listeners.set(id,cb),removeListener:(channel,id)=>listeners.delete(id),send:(channel,msg)=>{
   const emit=data=>queueMicrotask(()=>listeners.forEach(cb=>cb({channel:msg.channel,data})));
   if(msg.channel==='SEARCH_LYRICS'){window.attempts++;emit(window.attempts===1?{error:'Lyrics service is temporarily rate-limited.'}:[{source:'LRCLIB',key:'1',title:'Hosanna',artist:'Fixture singer'}])}
   if(msg.channel==='GET_LYRICS')emit({source:'LRCLIB',title:'Hosanna',artist:'Fixture singer',lyrics:'Fixture verse'})
  }}
 })
 await page.goto('http://127.0.0.1:3000/lyrics-fixture')
 await page.evaluate(async()=>{
  await import('/src/frontend/App.svelte');
  const {default:Component}=await import('/src/frontend/components/main/popups/createShow/WebSearch.svelte');
  window.component=new Component({target:document.querySelector('#fixture'),props:{query:'Hossana'}});
  window.component.$on('update',e=>window.chosen=e.detail)
 })
 await page.getByRole('alert').getByText('Lyrics service is temporarily rate-limited.').waitFor()
 await page.getByRole('button',{name:'Retry search',exact:true}).click()
 await page.getByText('Hosanna',{exact:true}).click()
 await page.waitForFunction(()=>window.chosen?.lyrics==='Fixture verse')
 assert.equal(await page.getByRole('alert').count(),0)
 assert.deepEqual(errors,[])
 console.log('PASS lyrics search error, retry, results and selected lyrics delivery')
}finally{await browser.close()}
