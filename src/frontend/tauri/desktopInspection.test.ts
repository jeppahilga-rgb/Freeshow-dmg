import { beforeEach, expect, it, vi } from "vitest"
const {invoke}=vi.hoisted(()=>({invoke:vi.fn()}))
vi.mock("@tauri-apps/api/core",()=>({invoke}))
import {desktopService} from "./desktopServices"
beforeEach(()=>invoke.mockReset())
it("probes WebM codecs without feeding it to the MP4 reader",async()=>{
 invoke.mockResolvedValue({streams:[{codec_name:"vp9",codec_type:"video"},{codec_name:"opus",codec_type:"audio"}]})
 expect(await desktopService("MEDIA_CODEC",{path:"C:/clip.webm"})).toMatchObject({codecs:["vp9","opus"],mimeType:"video/webm"})
 expect(invoke).toHaveBeenCalledTimes(1)
 expect(invoke).toHaveBeenCalledWith("desktop_service",{operation:"MEDIA_PROBE",data:{path:"C:/clip.webm"}})
})
it("does not scan a WAV file as MP4 to look for captions",async()=>{
 invoke.mockResolvedValue({streams:[{codec_name:"pcm_s16le",codec_type:"audio"}]})
 expect(await desktopService("MEDIA_TRACKS",{path:"C:/clip.wav"})).toEqual({path:"C:/clip.wav",tracks:[]})
 expect(invoke).toHaveBeenCalledTimes(1)
})
it("routes MKV subtitle extraction to the bounded backend converter",async()=>{
 const streams=[{index:2,codec_name:"subrip",codec_type:"subtitle"}]
 invoke.mockResolvedValueOnce({streams}).mockResolvedValueOnce({path:"C:/clip.mkv",tracks:[{vtt:"WEBVTT"}]})
 expect(await desktopService("MEDIA_TRACKS",{path:"C:/clip.mkv"})).toMatchObject({tracks:[{vtt:"WEBVTT"}]})
 expect(invoke).toHaveBeenLastCalledWith("backend_service",{operation:"MEDIA_SUBTITLES",data:{path:"C:/clip.mkv",streams}})
})
it("reports incomplete MP4 metadata instead of caching an empty success",async()=>{
 invoke.mockResolvedValue({base64:'',size:0,eof:true})
 await expect(desktopService("MEDIA_CODEC",{path:"C:/broken.mp4"})).rejects.toThrow(/incomplete|valid MP4/)
})
it("reports incomplete MP4 captions instead of silently losing them",async()=>{
 invoke.mockResolvedValue({base64:'',size:0,eof:true})
 await expect(desktopService("MEDIA_TRACKS",{path:"C:/broken.mp4"})).rejects.toThrow(/incomplete subtitle/)
})
