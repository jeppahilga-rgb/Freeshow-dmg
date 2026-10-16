import { invoke } from "@tauri-apps/api/core"
import { get } from "svelte/store"
import { disabledServers, serverData, outputs } from "../stores"
import {backendService} from './backendServices'
import {connectMediaTransport,sendEngineAudio} from './mediaTransport'
import {getCurrentWindow} from '@tauri-apps/api/window'

export function planarToInterleaved(buffer: ArrayBuffer | ArrayBufferView): number[] {
    const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    if (bytes.byteLength % 8) throw Error("Invalid stereo PCM frame")
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const frames = bytes.byteLength / 8
    const result = new Array<number>(frames * 2)
    for (let i = 0; i < frames; i++) for (let channel = 0; channel < 2; channel++) {
        const value = view.getFloat32((channel * frames + i) * 4, true)
        const sample = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0
        result[i * 2 + channel] = Math.round(sample * (sample < 0 ? 32768 : 32767))
    }
    return result
}

export function createAudioTransport(onError: (error: unknown) => void) {
    const ports = new Map<string, MessagePort>()
    let pending = 0
    async function sendPCM(payload: any) {
        sendEngineAudio(payload)
        if (get(disabledServers).output_stream !== false || !get(serverData).output_stream?.sendAudio) return
        const target = get(serverData).output_stream?.outputId || Object.entries(get(outputs)).find(([, output]) => output.enabled && output.active)?.[0]
        if (payload.id && target && payload.id !== target) return
        if (pending >= 2) return // Drop late frames instead of accumulating audio latency.
        const rate = Number(payload.sampleRate) || 48000
        if (!Number.isFinite(rate) || rate < 8000 || rate > 192000) throw Error("Invalid audio sample rate")
        const samples = planarToInterleaved(payload.buffer)
        if (samples.length > rate * 2) throw Error("Audio frame exceeds one second")
        pending++
        try { await invoke("local_server_send", { kind: "output_stream", msg: { channel: "AUDIO_BUFFER", data: { buffer: samples, sampleRate: rate, channelCount: 2 } } }) }
        finally { pending-- }
    }
    return async (message: any) => {
        const id = String(message.data?.id || "default")
        if (message.channel === "RESET_DECODER") return
        if (message.channel === "CLOSE_PORT") { ports.get(id)?.close(); ports.delete(id);if((window as any).__TAURI_INTERNALS__)await backendService('AUDIO_CLOSE',{id}); return }
        if (message.channel === "INIT_PORT") {
            if((window as any).__TAURI_INTERNALS__){const target=getCurrentWindow().label==='main'?'app':getCurrentWindow().label.replace(/^output-/,'');connectMediaTransport((await backendService('MEDIA_TRANSPORT',{target})).url)}
            ports.get(id)?.close()
            const { port1, port2 } = new MessageChannel()
            ports.set(id, port1)
            port1.onmessage = event => { if (event.data?.channel === "AUDIO") void sendPCM(event.data.payload).catch(onError) }
            port1.start()
            window.postMessage({ type: "AUDIO_PORT_RESPONSE", targetId: message.data?.id }, "*", [port2])
            return
        }
        if (["PCM", "CAPTURE"].includes(message.channel)) { await sendPCM(message.data); return }
        throw Error(`Unknown audio transport action: ${message.channel}`)
    }
}
