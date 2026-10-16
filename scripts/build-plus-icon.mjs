import fs from 'node:fs/promises'
import {chromium} from 'playwright'
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try{
 const page=await browser.newPage({viewport:{width:256,height:256},deviceScaleFactor:1})
 const svg=await fs.readFile('public/freeshow-plus.svg','utf8')
 await page.setContent(`<style>html,body{margin:0;background:transparent;width:256px;height:256px}svg{display:block;width:256px;height:256px}</style>${svg}`)
 const png=await page.screenshot({omitBackground:true})
 const sizes=[16,32,48,256],frames=[]
 for(const size of sizes){
  const pixels=await page.evaluate(async({svg,size})=>{const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(svg);await image.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=size;const context=canvas.getContext('2d');context.drawImage(image,0,0,size,size);return Array.from(context.getImageData(0,0,size,size).data)},{svg,size})
  const maskStride=Math.ceil(size/32)*4,frame=Buffer.alloc(40+size*size*4+maskStride*size)
  frame.writeUInt32LE(40,0);frame.writeInt32LE(size,4);frame.writeInt32LE(size*2,8);frame.writeUInt16LE(1,12);frame.writeUInt16LE(32,14);frame.writeUInt32LE(size*size*4,20)
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){const input=(y*size+x)*4,output=40+((size-1-y)*size+x)*4;frame[output]=pixels[input+2];frame[output+1]=pixels[input+1];frame[output+2]=pixels[input];frame[output+3]=pixels[input+3]}
  frames.push(frame)
 }
 const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length
 sizes.forEach((size,index)=>{const entry=6+index*16;header[entry]=header[entry+1]=size===256?0:size;header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6);header.writeUInt32LE(frames[index].length,entry+8);header.writeUInt32LE(offset,entry+12);offset+=frames[index].length})
 const ico=Buffer.concat([header,...frames])
 for(const target of ['public/icon.png','src/server/icon.png'])await fs.writeFile(target,png)
 for(const target of ['public/icon.ico','src-tauri/icons/icon.ico'])await fs.writeFile(target,ico)
 console.log('Generated FreeShow+ PNG and Windows ICO from SVG')
}finally{await browser.close()}
