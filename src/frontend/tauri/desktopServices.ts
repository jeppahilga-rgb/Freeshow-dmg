import { invoke } from '@tauri-apps/api/core'
import { createFile } from 'mp4box'
import { backendService } from './backendServices'

export const desktopCommands = new Set(['GET_DEVICE_NAME','GET_PATHS','GET_GRAPHICS_DEVICES','CHECK_RAM_USAGE','GET_STORE_VALUE','SET_STORE_VALUE','SET_MEDIA_FOLDER_PATH','GET_MEDIA_FOLDER_PATH','OPEN_LOG','OPEN_CACHE','OPEN_APPDATA','OPEN_NOW_PLAYING','SYSTEM_OPEN','LOG','LOG_ERROR','SAVE_IMAGE','RECORDER','MEDIA_FOLDER_COPY','REFRESH_SHOWS','GET_EMPTY_SHOWS','DELETE_SHOWS','DELETE_SHOWS_NI','FFMPEG_CHECK','EMIT_OSC','NOW_PLAYING','NOW_PLAYING_UNSET','MEDIA_CODEC','MEDIA_TRACKS'])
export const midiCommands = new Set(['GET_MIDI_INPUTS','GET_MIDI_OUTPUTS','SEND_MIDI','RECEIVE_MIDI','CLOSE_MIDI'])
const native = (operation: string, data: unknown = null) => invoke<any>('desktop_service', { operation, data })
function encoded(buffer: ArrayBuffer | Uint8Array): string {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
    let text = ''; for (let offset=0;offset<bytes.length;offset+=8192) text += String.fromCharCode(...bytes.subarray(offset,offset+8192))
    return btoa(text)
}
const mime = (path: string) => /\.(m4a|m4b|aac)$/i.test(path) ? 'audio/mp4' : /\.mov$/i.test(path) ? 'video/quicktime' : 'video/mp4'
function timestamp(seconds: number) { const ms=Math.max(0,Math.round(seconds*1000)),pad=(n:number,w=2)=>String(Math.floor(n)).padStart(w,'0');return `${pad(ms/3600000)}:${pad(ms%3600000/60000)}:${pad(ms%60000/1000)}.${pad(ms%1000,3)}` }
function subtitleText(codec: string, bytes: Uint8Array) {
    if (codec.startsWith('tx3g') && bytes.length>=2) { const count=(bytes[0]<<8)|bytes[1]; bytes=bytes.subarray(2,2+count) }
    if (codec.startsWith('wvtt')) {
        const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);const texts:string[]=[]
        function boxes(start:number,end:number) {for(let offset=start;offset+8<=end;){const size=view.getUint32(offset);if(size<8||offset+size>end)break;const kind=String.fromCharCode(...bytes.subarray(offset+4,offset+8));if(kind==='vttc')boxes(offset+8,offset+size);else if(kind==='payl')texts.push(new TextDecoder().decode(bytes.subarray(offset+8,offset+size)));offset+=size}}
        boxes(0,bytes.length);return texts.join('\n')
    }
    const utf16=bytes[0]===0xfe&&bytes[1]===0xff?'utf-16be':bytes[0]===0xff&&bytes[1]===0xfe?'utf-16le':'utf-8'
    return new TextDecoder(utf16).decode(bytes).replace(/[\x00-\x08\x0B-\x1F]/g,'').trim()
}
async function inspectMp4(path: string, subtitles: boolean) {
    const parser:any=createFile();let finished=false,result:any=subtitles?{path,tracks:[]}:{path,codecs:[],mimeType:mime(path),mimeCodec:''},failure:Error|undefined
    const tracks=new Map<number,{info:any,cues:string[],next:number}>();let pending=0
    parser.onError=(message:string)=>{failure=new Error(message);finished=true}
    parser.onReady=(info:any)=>{
        if (!subtitles) {const codecs=info.tracks.map((t:any)=>t.codec).filter(Boolean);result={path,codecs,mimeType:mime(path),mimeCodec:codecs.length?`${mime(path)}; codecs="${codecs.join(', ')}"`:''};finished=true;return}
        for(const track of info.tracks.filter((t:any)=>['subtitles','text'].includes(t.type))){pending++;tracks.set(track.id,{info:track,cues:['WEBVTT\n'],next:0});parser.setExtractionOptions(track.id,null,{nbSamples:Math.min(track.nb_samples||1000,1000)})}
        if(!pending)finished=true;else parser.start()
    }
    parser.onSamples=(id:number,_:unknown,samples:any[])=>{
        const item=tracks.get(id);if(!item)return
        for(const sample of samples){const text=subtitleText(item.info.codec,new Uint8Array(sample.data));if(text)item.cues.push(`${item.next+1}\n${timestamp(sample.cts/item.info.timescale)} --> ${timestamp((sample.cts+sample.duration)/item.info.timescale)}\n${text}\n`);item.next++}
        parser.releaseUsedSamples?.(id,item.next)
        if(item.next>=item.info.nb_samples){if(item.cues.length>1)result.tracks.push({lang:(item.info.language||'und').slice(0,2),name:item.info.language||'und',vtt:item.cues.join('\n'),embedded:true});tracks.delete(id);if(--pending===0)finished=true}
    }
    let offset=0
    try {
        while(!finished){const chunk=await native('READ_BINARY',{path,offset,length:1024*1024});const text=atob(chunk.base64),bytes=new Uint8Array(text.length);for(let n=0;n<text.length;n++)bytes[n]=text.charCodeAt(n);if(!bytes.length){parser.flush();break}const buffer:any=bytes.buffer;buffer.fileStart=offset;const next=parser.appendBuffer(buffer);offset=Number.isFinite(next)&&next>offset?next:offset+bytes.length;if(offset>=chunk.size){parser.flush();break}}
        if(failure)throw failure
        if(!finished)throw Error(subtitles?'The media file contains incomplete subtitle data.':'The media file is incomplete or is not a valid MP4 file.')
        return result
    } finally {parser.stop()}
}
export async function desktopService(command: string, data: any) {
    if (midiCommands.has(command)) return invoke('midi_service',{operation:command,data:data??null})
    if (command==='MEDIA_CODEC') {
        if (/\.(mp4|m4v|m4a|m4b|mov)$/i.test(data.path)) return inspectMp4(data.path,false)
        const probe=await native('MEDIA_PROBE',{path:data.path})
        const codecs=(probe.streams||[]).map((stream:any)=>stream.codec_name).filter(Boolean)
        const extension=data.path.split('.').pop().toLowerCase()
        const mimeTypes:Record<string,string>={webm:'video/webm',mkv:'video/x-matroska',avi:'video/x-msvideo',wmv:'video/x-ms-wmv',wav:'audio/wav',mp3:'audio/mpeg',ogg:'audio/ogg',flac:'audio/flac',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg'}
        const mimeType=mimeTypes[extension]||'application/octet-stream'
        return {path:data.path,codecs,mimeType,mimeCodec:codecs.length?`${mimeType}; codecs="${codecs.join(', ')}"`:''}
    }
    if (command==='MEDIA_TRACKS') {
        if (/\.(mp4|m4v|m4a|m4b|mov)$/i.test(data.path)) return inspectMp4(data.path,true)
        const probe=await native('MEDIA_PROBE',{path:data.path})
        if (!(probe.streams||[]).some((stream:any)=>stream.codec_type==='subtitle')) return {path:data.path,tracks:[]}
        return backendService('MEDIA_SUBTITLES',{path:data.path,streams:probe.streams})
    }
    if (command==='SAVE_IMAGE' && data.buffer) data={...data,buffer:undefined,base64:encoded(data.buffer)}
    if (command==='RECORDER') {
        const bytes=new Uint8Array(data.blob),session=await native('RECORDING_BEGIN',{name:data.name,path:data.path})
        try {for(let offset=0;offset<bytes.length;offset+=4*1024*1024)await native('RECORDING_CHUNK',{id:session.id,offset,base64:encoded(bytes.subarray(offset,offset+4*1024*1024))});return await native('RECORDING_FINISH',{id:session.id,size:bytes.length})}
        catch(error){await native('RECORDING_ABORT',{id:session.id}).catch(()=>{});throw error}
    }
    if (command==='NOW_PLAYING' && navigator.mediaSession) navigator.mediaSession.metadata=new MediaMetadata({title:data.name||'',artist:'FreeShow'})
    if (command==='NOW_PLAYING_UNSET' && navigator.mediaSession) navigator.mediaSession.metadata=null
    return native(command,data??null)
}
