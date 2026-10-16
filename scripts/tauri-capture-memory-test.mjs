import {chromium} from 'playwright'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import fs from 'node:fs/promises'
const run=promisify(execFile),pid=process.argv[2]
if(!/^\d+$/.test(pid))throw Error('Supply own test app PID')
const memory=async()=>JSON.parse((await run('powershell',['-NoProfile','-Command',`$taskRoot=${pid};$taskProcesses=Get-CimInstance Win32_Process;$taskIds=[System.Collections.Generic.HashSet[int]]::new();[void]$taskIds.Add($taskRoot);do{$taskCount=$taskIds.Count;foreach($taskProcess in $taskProcesses){if($taskIds.Contains([int]$taskProcess.ParentProcessId)){[void]$taskIds.Add([int]$taskProcess.ProcessId)}}}while($taskIds.Count -ne $taskCount);$taskMemory=foreach($taskId in $taskIds){Get-Process -Id $taskId -ErrorAction SilentlyContinue};@{Processes=$taskMemory.Count;TotalWorkingSetMB=[math]::Round(($taskMemory|Measure-Object WorkingSet64 -Sum).Sum/1MB,1);TotalPrivateMB=[math]::Round(($taskMemory|Measure-Object PrivateMemorySize64 -Sum).Sum/1MB,1)}|ConvertTo-Json -Compress`])).stdout)
const b=await chromium.connectOverCDP('http://127.0.0.1:9224');const context=b.contexts()[0];let main
for(const p of context.pages())try{if(await p.evaluate(()=>window.__TAURI_INTERNALS__?.metadata.currentWindow.label)==='main')main=p}catch{}
await main.waitForFunction(()=>window.api)
await main.evaluate(()=>{window.memoryStreams?.forEach(s=>s.getTracks().forEach(t=>t.stop()))})
const config={id:'memory-probe',bounds:{x:100,y:100,width:1920,height:1080},boundsLocked:true,alwaysOnTop:false}
await main.evaluate(config=>window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'TOGGLE_OUTPUTS',data:{state:true,outputs:[config]}}}),config)
let fixture
for(let n=0;n<40;n++){for(const p of context.pages())try{if(await p.evaluate(()=>window.__TAURI_INTERNALS__?.metadata.currentWindow.label)==='output-memory-probe')fixture=p}catch{}if(fixture)break;await main.waitForTimeout(300)}
await fixture.waitForFunction(()=>window.api);await fixture.waitForTimeout(1500)
await main.evaluate(()=>window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'SET_VALUE',data:{id:'memory-probe',key:'name',value:'Capture memory fixture'}}}))
await fixture.evaluate(()=>document.body.innerHTML='<div style="position:fixed;inset:0;background:rgb(22,196,91)"></div>')
const source=await main.evaluate(async()=> (await window.__TAURI_INTERNALS__.invoke('native_sources')).find(s=>s.name==='Capture memory fixture'))
await main.evaluate(async id=>{window.memoryStreams=[];for(let n=0;n<3;n++)window.memoryStreams.push(await navigator.mediaDevices.getUserMedia({video:{mandatory:{chromeMediaSource:'desktop',chromeMediaSourceId:id}}}))},source.id)
const samples=[]
for(let n=0;n<4;n++){samples.push(await memory());console.log('Capture memory sample',n,samples.at(-1));if(n<3)await main.waitForTimeout(10000)}
await main.evaluate(()=>window.memoryStreams.forEach(s=>s.getTracks().forEach(t=>t.stop())))
await main.evaluate(config=>window.__TAURI_INTERNALS__.invoke('output_message',{msg:{channel:'TOGGLE_OUTPUTS',data:{state:false,outputs:[config]}}}),config)
await main.waitForTimeout(3000);const stopped=await memory()
await fs.writeFile('tauri-test-output/capture-memory.json',JSON.stringify({samples,stopped},null,2))
console.log('Memory after stopping',stopped)
await b.close()
