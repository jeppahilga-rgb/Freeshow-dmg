import http from 'node:http'
import fs from 'node:fs/promises'
import {once} from 'node:events'
import {chromium} from 'playwright'
const manifest=JSON.parse(await fs.readFile('public/fonts/google/manifest.json','utf8')),requests=[]
// Match the native embedded server's URI lookup and default font MIME handling.
const server=http.createServer(async(req,res)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<link rel="stylesheet" href="/fonts/google/fonts.css">');return}const pathname=req.url.split('?')[0];requests.push(pathname);try{const body=await fs.readFile('dist-local/stage'+pathname);res.setHeader('Content-Type',pathname.endsWith('.css')?'text/css':'text/html');res.end(body)}catch{res.writeHead(404).end()}})
server.listen(0,'127.0.0.1');await once(server,'listening')
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try{const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);await page.evaluate(async records=>{await document.fonts.ready;for(const face of records){const loaded=await document.fonts.load(`${face.style} ${face.weight.split(' ')[0]} 32px "${face.family}"`);if(!loaded.length)throw Error('Font not loaded: '+face.family)}},manifest.records);console.log('PASS: embedded local server URI and MIME behavior loads all bundled font faces')}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.writeFile('../output/bundled-font-server-requests.json',JSON.stringify(requests,null,2))}
