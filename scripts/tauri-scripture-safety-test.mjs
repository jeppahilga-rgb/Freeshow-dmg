import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try{
 const page=await browser.newPage();await page.route('**/safety-fixture',r=>r.fulfill({contentType:'text/html',body:'<div id="fixture"></div>'}));await page.addInitScript(()=>window.api={send(){},receive(){},removeListener(){}});await page.goto('http://127.0.0.1:3000/safety-fixture')
 const result=await page.evaluate(async()=>{
  await import('/src/frontend/App.svelte');const {formatBibleText,sanitizeVerseText}=await import('/src/frontend/components/drawer/bible/scripture.ts');const target=document.querySelector('#fixture');const payloads=[
   '<img src="/missing-image" onerror="window.attack=1">', '<svg onload="window.attack=1"><script>window.attack=1</script></svg>', '<iframe srcdoc="<script>parent.attack=1</script>"></iframe>', '<script>window.attack=1</script>', '<span class="wj evil" id="__svelte" style="color:red" onclick="window.attack=1">Jesus</span>', '<a href="javascript:window.attack=1">Verse</a>', '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=window.attack=1>">', '<form id="__svelte"><input name="metadata"></form>', '&lt;img src=x onerror=window.attack=1&gt;', '&amp;lt;img src=x onerror=window.attack=1&amp;gt;', '<h4 onclick="window.attack=1">Heading</h4>', '<span class="undertitle" data-x="x" onmouseover="window.attack=1">Heading</span>'
  ];const cases=[];window.attack=0
  for(const payload of payloads)for(const format of [formatBibleText,sanitizeVerseText]){const html=format(payload,true);target.innerHTML=html;await new Promise(r=>setTimeout(r,30));const unsafe=[...target.querySelectorAll('*')].some(e=>!['SPAN','B','STRONG','I','EM','U','S','SUP','SUB','BR'].includes(e.tagName)||[...e.attributes].some(a=>a.name!=='class'));cases.push({html,unsafe})}
  target.innerHTML=formatBibleText('!{Jesus}! <b>bold</b> <i>italic</i><sup>2</sup>',true);const formatting=!!target.querySelector('span.wj')&&!!target.querySelector('b')&&!!target.querySelector('i')&&!!target.querySelector('sup');target.innerHTML=formatBibleText('<h4>Heading</h4>Verse');const heading=target.querySelector('.undertitle')?.textContent.trim()==='Heading';return {cases,executed:window.attack,formatting,heading}
 });assert.equal(result.executed,0);assert.ok(result.cases.every(c=>!c.unsafe));assert.equal(result.formatting,true);assert.equal(result.heading,true);await fs.writeFile('../output/audit-fixes-scripture-safety.json',JSON.stringify(result,null,2));console.log('PASS: 24 hostile markup cases blocked; red-letter, undertitle and inline formatting retained')
}finally{await browser.close()}
