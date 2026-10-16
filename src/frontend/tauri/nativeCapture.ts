import { invoke } from "@tauri-apps/api/core"

export type CaptureSource = { id: string; name: string; kind: "screen" | "window" }
const active = new Set<() => void>()
export function nativeSources() { return invoke<CaptureSource[]>("native_sources") }
export function openCaptureBrowser(url: string) { return invoke<void>("native_capture_browser", { url }) }
export async function nativeThumbnail(id: string) {
    const bytes = await invoke<ArrayBuffer>("native_thumbnail", { id })
    return URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }))
}
export async function nativeCaptureStream(id: string): Promise<MediaStream> {
    const consumer = crypto.randomUUID()
    await invoke("native_capture_start", { id, consumer })
    const canvas = document.createElement("canvas")
    // Frames are drawn, never read back. Let WebView2 choose an accelerated canvas.
    const context = canvas.getContext("2d")!
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    let stream: MediaStream | undefined
    const image = new Image()
    let previous: Uint8Array | undefined
    const stop = () => {
        if (stopped) return
        stopped = true; clearTimeout(timer); active.delete(stop)
        canvas.width = 1; canvas.height = 1
        image.src = ""; previous = undefined
        void invoke("native_capture_stop", { id, consumer }).catch(() => {})
    }
    active.add(stop)
    async function draw() {
        const bytes = await invoke<ArrayBuffer>("native_capture_frame", { id, consumer })
        if (!bytes.byteLength || stopped) return false
        const next = new Uint8Array(bytes)
        if (previous?.length === next.length && next.every((value, index) => value === previous![index])) return false
        previous = next
        const url = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }))
        try {
            await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Could not decode capture frame")); image.src = url })
            if (!stopped) {
                if (canvas.width !== image.naturalWidth || canvas.height !== image.naturalHeight) { canvas.width = image.naturalWidth; canvas.height = image.naturalHeight }
                context.drawImage(image, 0, 0)
            }
        } finally { URL.revokeObjectURL(url); image.src = "" }
        return true
    }
    try {
        const started = performance.now()
        while (!await draw()) {
            if (performance.now() - started > 6000) throw new Error("Capture unavailable. Restore the window and select it again.")
            await new Promise(resolve => setTimeout(resolve, 50))
        }
        stream = canvas.captureStream(0)
        const videoTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
        videoTrack.contentHint = "detail"
        videoTrack.requestFrame()
        let requestedAt = performance.now()
        for (const track of stream.getTracks()) {
            const originalStop = track.stop.bind(track)
            track.stop = () => { originalStop(); stop() }
            track.addEventListener("ended", stop)
        }
        const poll = async () => {
            if (stopped) return
            try { if (await draw() || performance.now() - requestedAt > 1000) { videoTrack.requestFrame(); requestedAt = performance.now() } }
            catch (error) { console.warn("Native capture ended:", error); stream?.getTracks().forEach(track => track.stop()); stop(); return }
            if (!stopped) timer = setTimeout(poll, 66)
        }
        void poll()
        return stream
    } catch (error) { stop(); throw error }
}
window.addEventListener("beforeunload", () => active.forEach(stop => stop()))
