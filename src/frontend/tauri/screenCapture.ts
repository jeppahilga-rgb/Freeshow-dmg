import { writable } from "svelte/store"
import { emit, listen } from "@tauri-apps/api/event"
import { nativeCaptureStream } from "./nativeCapture"
import { getCurrentWindow } from "@tauri-apps/api/window"
const cameraReleases = new Map<string, () => void>()
const cameraErrors = new Map<string, (error: Error) => void>()
export function remoteCameraStream(id: string) { return remoteStream(`tauri-camera:${id}`) }

export const isTauriCapture = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
export const sharedScreens = writable<{ id: string; name: string }[]>([])
const sources = new Map<string, MediaStream>()
const peers = new Map<string, RTCPeerConnection>()
const pendingIce = new Map<string, RTCIceCandidateInit[]>()
const peerSources = new Map<string, string>()
let bus: { postMessage: (data: any) => void; close: () => void }
let session: string
export function screenSources() { return [...sources].map(([id, stream]) => ({ id, name: stream.getVideoTracks()[0]?.label || "Shared screen" })) }
function publish() { sharedScreens.set(screenSources()) }
function closePeer(key: string, error = new Error("Screen or camera connection ended.")) {
    const pc = peers.get(key)
    const reject = cameraErrors.get(key)
    cameraErrors.delete(key)
    peers.delete(key); pendingIce.delete(key); peerSources.delete(key)
    pc?.close()
    cameraReleases.get(key)?.(); cameraReleases.delete(key)
    if (pc) bus?.postMessage({ type: "close", key, sender: session })
    reject?.(error)
}
export async function chooseScreen() {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 60 } }, audio: false })
    return registerScreen(stream)
}
export function registerScreen(stream: MediaStream) {
    const id = `tauri-screen-${crypto.randomUUID()}`
    sources.set(id, stream)
    stream.getVideoTracks()[0].addEventListener("ended", () => { sources.delete(id); publish(); bus.postMessage({ type: "ended", id }) })
    publish()
    return { id, name: stream.getVideoTracks()[0].label || "Shared screen" }
}
export function stopScreen(id: string) { sources.get(id)?.getTracks().forEach(track => track.stop()); sources.delete(id); publish(); bus.postMessage({ type: "ended", id }) }
function peer(key: string, target: string, id: string) {
    const pc = new RTCPeerConnection()
    peers.set(key, pc)
    peerSources.set(key, id)
    pc.onicecandidate = event => { if (event.candidate) bus.postMessage({ type: "ice", key, target, sender: session, candidate: event.candidate.toJSON() }) }
    pc.onconnectionstatechange = () => {
        if (["failed", "closed"].includes(pc.connectionState)) closePeer(key)
        if (pc.connectionState === "disconnected") setTimeout(() => { if (pc.connectionState === "disconnected") closePeer(key) }, 3000)
    }
    return pc
}
async function remoteDescription(key: string, pc: RTCPeerConnection, description: RTCSessionDescriptionInit) {
    await pc.setRemoteDescription(description)
    for (const candidate of pendingIce.get(key) || []) await pc.addIceCandidate(candidate)
    pendingIce.delete(key)
}
function remoteStream(id: string): Promise<MediaStream> {
    const local = sources.get(id)
    if (local?.active) return Promise.resolve(local.clone())
    return new Promise((resolve, reject) => {
        const key = crypto.randomUUID()
        const timeout = setTimeout(() => closePeer(key, new Error("Screen sharing ended. Select the screen again in the main window.")), 15000)
        cameraErrors.set(key, error => { clearTimeout(timeout); cameraErrors.delete(key); closePeer(key, error); reject(error) })
        const pc = peer(key, "", id)
        pc.ontrack = event => {
            clearTimeout(timeout)
            cameraErrors.delete(key)
            const stream = event.streams[0] || new MediaStream([event.track])
            for (const track of stream.getTracks()) {
                const stop = track.stop.bind(track)
                track.stop = () => { stop(); closePeer(key) }
            }
            event.track.addEventListener("ended", () => closePeer(key))
            resolve(stream)
        }
        bus.postMessage({ type: "request", id, key, sender: session })
    })
}
export async function installScreenCapture() {
    session = crypto.randomUUID()
    bus = { postMessage: data => { void emit("freeshow-screen-signal", data) }, close: () => {} }
    const unlisten = await listen<any>("freeshow-screen-signal", async ({ payload: data }) => {
        if (data.sender === session || (data.target && data.target !== session)) return
        try {
            if (data.type === "camera-error") { cameraErrors.get(data.key)?.(new Error(data.error)); return }
            if (data.type === "close") { closePeer(data.key); return }
            if (data.type === "request" && data.id?.startsWith("tauri-camera:") && getCurrentWindow().label === "main") {
                const id = data.id.slice("tauri-camera:".length)
                const {cameraManager} = await import("../media/cameraManager")
                const stream = await cameraManager.getCameraStream(id)
                if (typeof stream === "string") { bus.postMessage({type:"camera-error",key:data.key,sender:session,target:data.sender,error:stream}); return }
                sources.set(data.id, stream)
                cameraReleases.set(data.key,()=>{cameraManager.stopTracks(stream,id);if(!stream.active)sources.delete(data.id)})
            }
            if (data.type === "ended") { for (const [key, id] of peerSources) if (id === data.id) closePeer(key); return }
            if (data.type === "request" && sources.has(data.id)) {
                const pc = peer(data.key, data.sender, data.id)
                for (const track of sources.get(data.id)!.getTracks()) {
                    const sender = pc.addTrack(track, sources.get(data.id)!)
                    if (track.kind === "video") {
                        const parameters = sender.getParameters()
                        parameters.encodings = [{ ...(parameters.encodings?.[0] || {}), maxBitrate: 12_000_000, scaleResolutionDownBy: 1 }]
                        parameters.degradationPreference = "maintain-resolution"
                        await sender.setParameters(parameters)
                    }
                }
                await pc.setLocalDescription(await pc.createOffer())
                bus.postMessage({ type: "offer", key: data.key, sender: session, target: data.sender, description: pc.localDescription })
            } else if (data.type === "offer" && peers.has(data.key)) {
                const pc = peers.get(data.key)!
                pc.onicecandidate = event => { if (event.candidate) bus.postMessage({ type: "ice", key: data.key, target: data.sender, sender: session, candidate: event.candidate.toJSON() }) }
                await remoteDescription(data.key, pc, data.description)
                await pc.setLocalDescription(await pc.createAnswer())
                bus.postMessage({ type: "answer", key: data.key, target: data.sender, sender: session, description: pc.localDescription })
            } else if (data.type === "answer" && peers.has(data.key)) await remoteDescription(data.key, peers.get(data.key)!, data.description)
            else if (data.type === "ice" && peers.has(data.key)) {
                const pc = peers.get(data.key)!
                if (pc.remoteDescription) await pc.addIceCandidate(data.candidate)
                else pendingIce.set(data.key, [...(pendingIce.get(data.key) || []), data.candidate])
            }
        } catch (error) { console.error("Screen stream connection failed:", error); closePeer(data.key) }
    })
    bus.close = unlisten
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = constraints => {
        const desktop = (constraints.video as any)?.mandatory
        if (desktop?.chromeMediaSource === "desktop") return desktop.chromeMediaSourceId?.startsWith("native-") ? nativeCaptureStream(desktop.chromeMediaSourceId) : remoteStream(desktop.chromeMediaSourceId)
        return getUserMedia(constraints)
    }
    window.addEventListener("beforeunload", () => { peers.forEach((pc,key) => {bus.postMessage({type:"close",key,sender:session});pc.close()});cameraReleases.forEach(release=>release());cameraReleases.clear(); sources.forEach(stream => stream.getTracks().forEach(track => track.stop())); bus.close() })
}
