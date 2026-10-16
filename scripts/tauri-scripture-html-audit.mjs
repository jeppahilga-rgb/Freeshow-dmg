import {chromium} from 'playwright'
import fs from 'node:fs/promises'
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try{
 const page=await browser.newPage()
 await page.route('**/audit-fixture',route=>route.fulfill({contentType:'text/html',body:'<div id="fixture"></div>'}))
 await page.addInitScript(()=>window.api={send(){},receive(){},removeListener(){}})
 await page.goto('http://127.0.0.1:3000/audit-fixture')
 const result=await page.evaluate(async()=>{
  await import('/src/frontend/App.svelte')
  const {formatBibleText}=await import('/src/frontend/components/drawer/bible/scripture.ts')
  const html=formatBibleText('<img src="/missing-audit-image" onerror="window.scriptureAuditMarker=1">',true)
  document.querySelector('#fixture').innerHTML=html
  await new Promise(resolve=>setTimeout(resolve,500))
  return {html,eventHandlerExecuted:window.scriptureAuditMarker===1}
 })
 await fs.writeFile('../output/reaudit-scripture-html.json',JSON.stringify(result,null,2))
 console.log(JSON.stringify(result))
}finally{await browser.close()}
