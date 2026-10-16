import fs from 'node:fs/promises'
import crypto from 'node:crypto'
const BLOCK=16,MAX=4*1024*1024
export async function encryptedRange(filePath:string,key:Buffer,range:string,method='GET',mime='application/octet-stream'){
 const file=await fs.open(filePath,'r');try{
  const size=(await file.stat()).size,cipherSize=size-BLOCK;if(cipherSize<BLOCK||cipherSize%BLOCK)throw Error('Invalid protected media file')
  const tail=Buffer.alloc(BLOCK*2);await file.read(tail,0,tail.length,size-tail.length);const final=crypto.createDecipheriv('aes-256-cbc',key,tail.subarray(0,BLOCK));const last=Buffer.concat([final.update(tail.subarray(BLOCK)),final.final()]);const total=cipherSize-BLOCK+last.length
  let start=0,end=Math.min(total-1,MAX-1);if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);if(!match||!match[1]&&!match[2])throw Error('Invalid protected media range');if(match[1]){start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),total-1,start+MAX-1):Math.min(total-1,start+MAX-1)}else{start=Math.max(0,total-Math.min(MAX,Number(match[2])));end=total-1}}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=total)return {status:416,headers:{'content-range':`bytes */${total}`,'accept-ranges':'bytes','cache-control':'no-store'},body:''}
  const headers={'content-type':mime,'content-length':String(end-start+1),'accept-ranges':'bytes','content-range':`bytes ${start}-${end}/${total}`,'cache-control':'no-store','content-disposition':'inline'};if(method==='HEAD')return {status:206,headers,body:''}
  const first=Math.floor(start/BLOCK),lastBlock=Math.floor(end/BLOCK),iv=Buffer.alloc(BLOCK);await file.read(iv,0,BLOCK,first*BLOCK);const buffer=Buffer.alloc((lastBlock-first+1)*BLOCK);const read=await file.read(buffer,0,buffer.length,BLOCK+first*BLOCK);if(read.bytesRead!==buffer.length)throw Error('Protected media file changed while reading');const decipher=crypto.createDecipheriv('aes-256-cbc',key,iv);decipher.setAutoPadding(false);const clear=Buffer.concat([decipher.update(buffer),decipher.final()]);return {status:206,headers,body:clear.subarray(start%BLOCK,start%BLOCK+end-start+1).toString('base64')}
 }finally{await file.close()}
}
