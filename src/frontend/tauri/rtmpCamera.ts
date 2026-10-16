import { invoke } from '@tauri-apps/api/core'

const report = (id: string, event: string, data: unknown = {}) => { void invoke('rtmp_input_request', { id, action: 'diagnostic', sdp: JSON.stringify({ event, data }), session: null }).catch(() => {}) }
export async function rtmpCameraStream(id: string): Promise<MediaStream> {
    for (let attempt = 0; attempt < 3; attempt++) {
        while (!(await invoke<{ ready: boolean }>('rtmp_input_request', { id, action: 'status', sdp: null, session: null })).ready) await new Promise(resolve => setTimeout(resolve, 1000))
        try { return await connectRtmp(id) } catch (error) { report(id, 'attempt-failed', String(error)); if (attempt === 2 || String(error).includes('stopped or restarted')) throw error; await new Promise(resolve => setTimeout(resolve, 1000)) }
    }
    throw new Error('RTMP camera connection failed.')
}
async function connectRtmp(id: string): Promise<MediaStream> {
    const pc = new RTCPeerConnection({ iceServers: [] })
    pc.addTransceiver('video', { direction: 'recvonly' }); report(id, 'receiver-start')
    let session = '', closed = false, timeout: ReturnType<typeof setTimeout>
    const cleanup = () => { if (closed) return; closed = true; clearTimeout(timeout); for (const receiver of pc.getReceivers()) receiver.track?.stop(); pc.close(); window.removeEventListener('beforeunload', cleanup); if (session) void invoke('rtmp_input_request', { id, action: 'delete', session, sdp: null }).catch(() => {}) }
    const streamPromise = new Promise<MediaStream>((resolve, reject) => {
        timeout = setTimeout(() => { cleanup(); reject(new Error('RTMP camera did not connect. Start livestreaming in DJI Mimo.')) }, 35000)
        pc.ontrack = event => {
            const stream = event.streams[0] || new MediaStream([event.track])
            for (const track of stream.getTracks()) { const stop = track.stop.bind(track); track.stop = () => { stop(); cleanup() }; track.addEventListener('ended', cleanup, { once: true }) }
            const deliver = () => { clearTimeout(timeout); report(id, 'video-flowing'); resolve(stream) }; report(id, 'track', { muted: event.track.muted }); if (!event.track.muted) deliver(); else event.track.addEventListener('unmute', deliver, { once: true })
        }
        pc.oniceconnectionstatechange = () => report(id, 'ice', pc.iceConnectionState)
        pc.onconnectionstatechange = () => { report(id, 'connection', pc.connectionState); if (pc.connectionState === 'failed') { clearTimeout(timeout); cleanup(); reject(new Error('RTMP camera connection interrupted.')) } }
    })
    // Handle a connection timeout even while the HTTP negotiation is pending.
    void streamPromise.catch(() => {})
    try {
        await pc.setLocalDescription(await pc.createOffer())
        if (pc.iceGatheringState !== 'complete') await new Promise<void>(resolve => { const timer = setTimeout(resolve, 5000); pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(timer); resolve() } }) })
        const deadline = Date.now() + 110000
        let answer: { sdp: string; session: string } | undefined
        while (!closed && Date.now() < deadline) {
            try { answer = await invoke('rtmp_input_request', { id, action: 'offer', sdp: pc.localDescription!.sdp, session: null }); break }
            catch (error) { if (!String(error).includes('Waiting for RTMP camera')) throw error; await new Promise(resolve => setTimeout(resolve, 1000)) }
        }
        if (answer && closed) void invoke('rtmp_input_request', { id, action: 'delete', session: answer.session, sdp: null }).catch(() => {})
        if (!answer || closed) throw new Error('Start livestreaming in DJI Mimo using the RTMP address shown in FreeShow.')
        session = answer.session
        report(id, 'answer', { localCandidates: (pc.localDescription?.sdp.match(/a=candidate:/g) || []).length, remoteCandidates: (answer.sdp.match(/a=candidate:/g) || []).length }); await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp })
        window.addEventListener('beforeunload', cleanup, { once: true })
        return await streamPromise
    } catch (error) { cleanup(); throw error }
}
