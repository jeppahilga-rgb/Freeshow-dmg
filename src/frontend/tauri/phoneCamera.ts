import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"

export async function phoneCameraStream(id: string): Promise<MediaStream> {
    await invoke("phone_camera_start", { id })
    const key = `${getCurrentWindow().label}:${crypto.randomUUID()}`
    const pc = new RTCPeerConnection({ iceServers: [] })
    let closed = false, pending: RTCIceCandidateInit[] = [], offered = false, requestAt = 0
    const signal = (message: any) => invoke("phone_camera_signal", { id, key, message })
    function cleanup() { if (closed) return; closed = true; pc.getReceivers().forEach(receiver => receiver.track?.stop()); pc.close(); window.removeEventListener("beforeunload", cleanup); void signal({ type: "close" }).catch(() => {}) }
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { cleanup(); reject(new Error("Phone not connected. Scan its QR code and tap Start camera.")) }, 120000)
        pc.onicecandidate = e => { if (e.candidate) void signal({ type: "candidate", candidate: e.candidate.toJSON() }).catch(() => {}) }
        pc.ontrack = event => {
            clearTimeout(timeout)
            const stream = event.streams[0] || new MediaStream([event.track])
            for (const track of stream.getTracks()) {
                const stop = track.stop.bind(track)
                track.stop = () => { stop(); cleanup() }
                track.addEventListener("ended", cleanup, { once: true })
            }
            resolve(stream)
        }
        pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") { clearTimeout(timeout); cleanup(); reject(new Error("Local phone connection failed. Check Wi-Fi/hotspot and Windows Firewall.")) } }
        async function poll() {
            if (closed) return
            try {
                if (!offered && Date.now() - requestAt > 2000) { await signal({ type: "request" }); requestAt = Date.now() }
                const messages = await invoke<any[]>("phone_camera_signal", { id, key, message: null })
                for (const message of messages) {
                    if (message.type === "offer") {
                        offered = true
                        await pc.setRemoteDescription(message.description)
                        for (const candidate of pending) await pc.addIceCandidate(candidate)
                        pending = []
                        await pc.setLocalDescription(await pc.createAnswer())
                        await signal({ type: "answer", description: pc.localDescription })
                    } else if (message.type === "candidate") {
                        if (pc.remoteDescription) await pc.addIceCandidate(message.candidate)
                        else pending.push(message.candidate)
                    } else if (message.type === "ended") { clearTimeout(timeout); cleanup(); reject(new Error("Phone camera stopped")) }
                }
            } catch (error) { clearTimeout(timeout); cleanup(); reject(error) }
            if (!closed) setTimeout(() => void poll(), 300)
        }
        void poll()
        window.addEventListener("beforeunload", cleanup, { once: true })
    })
}
