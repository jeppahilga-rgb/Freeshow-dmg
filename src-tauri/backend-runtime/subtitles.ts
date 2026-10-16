import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import path from 'node:path'
import fs from 'node:fs'
import {resolveFfmpegPath} from '../../src/electron/streaming/ffmpegManager'
const execute=promisify(execFile)
export async function mediaSubtitles(data:any){
 if(typeof data.path!=='string'||!path.isAbsolute(data.path)||!fs.statSync(data.path).isFile())throw Error('Select a local media file')
 const streams=Array.isArray(data.streams)?data.streams.filter((stream:any)=>stream.codec_type==='subtitle'):[]
 if(streams.length>8)throw Error('This file has too many subtitle tracks to extract at once')
 const supported=streams.filter((stream:any)=>['subrip','ass','ssa','webvtt','mov_text','text'].includes(stream.codec_name))
 if(streams.length&&!supported.length)throw Error('Image-based subtitles cannot be converted to text captions')
 if(!supported.length)return {path:data.path,tracks:[]}
 const ffmpeg=await resolveFfmpegPath();if(!ffmpeg)throw Error('Install FFmpeg in Settings to extract embedded subtitles')
 const tracks=[]
 for(const stream of supported){
  if(!Number.isInteger(stream.index)||stream.index<0||stream.index>1024)throw Error('Invalid subtitle stream')
  const {stdout}=await execute(ffmpeg,['-hide_banner','-nostdin','-loglevel','error','-i',data.path,'-map',`0:${stream.index}`,'-f','webvtt','pipe:1'],{windowsHide:true,timeout:30000,maxBuffer:4*1024*1024,encoding:'utf8'})
  if(!stdout.startsWith('WEBVTT'))throw Error('Subtitle extraction did not produce WebVTT')
  const language=String(stream.tags?.language||'und');tracks.push({lang:language.slice(0,2),name:String(stream.tags?.title||language),vtt:stdout,embedded:true})
 }
 return {path:data.path,tracks}
}
