import { expect, it, vi } from "vitest"
import { writable } from "svelte/store"
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue(null) }))
vi.mock("@tauri-apps/api/core", () => ({ invoke }))
vi.mock("../stores", () => ({ disabledServers: writable({output_stream:false}), serverData: writable({output_stream:{sendAudio:true,outputId:"output"}}), outputs:writable({}) }))
import { createAudioTransport, planarToInterleaved } from "./audioTransport"
it("interleaves and clips stereo samples, replacing non-finite samples with silence", () => {
    expect(planarToInterleaved(new Float32Array([-1,0.5,NaN,1,-2,Infinity]))).toEqual([-32768,32767,16384,-32768,0,0])
})
it("forwards PCM as signed samples for the existing stream receiver", async () => {
    await createAudioTransport(vi.fn())({channel:"PCM",data:{id:"output",sampleRate:48000,buffer:new Float32Array([1,-1])}})
    expect(invoke).toHaveBeenCalledWith("local_server_send", {kind:"output_stream",msg:{channel:"AUDIO_BUFFER",data:{buffer:[32767,-32768],sampleRate:48000,channelCount:2}}})
})
it("hands a working message port to the worklet and closes it on removal", async () => {
    const postMessage = vi.fn()
    vi.stubGlobal("window", {postMessage})
    const transport = createAudioTransport(vi.fn())
    await transport({channel:"INIT_PORT",data:{id:"output"}})
    const port = postMessage.mock.calls[0][2][0] as MessagePort
    invoke.mockClear()
    port.postMessage({channel:"AUDIO",payload:{id:"output",sampleRate:48000,buffer:new Float32Array([0.5,-0.5])}})
    await vi.waitFor(()=>expect(invoke).toHaveBeenCalledWith("local_server_send",expect.objectContaining({kind:"output_stream"})))
    await transport({channel:"CLOSE_PORT",data:{id:"output"}})
    port.close()
    vi.unstubAllGlobals()
})
