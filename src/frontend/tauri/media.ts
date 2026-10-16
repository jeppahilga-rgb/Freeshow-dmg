import { convertFileSrc, invoke } from "@tauri-apps/api/core"
const thumbnails = new Map<string, Promise<{input:string;output:string;size:number}>>()
let active = 0
const waiting: (() => void)[] = []
async function withDecoder(input: string, size: number) {
    if (active >= 2) await new Promise<void>(resolve => waiting.push(resolve))
    else active++
    try { return await createThumbnail(input, size) }
    finally { const next = waiting.shift(); if (next) next(); else active-- }
}
export async function mediaThumbnail(input: string, size = 250) {
    size = Math.max(32, Math.min(1920, size))
    const key = `${input}:${size}`
    if (thumbnails.has(key)) return thumbnails.get(key)!
    const pending = withDecoder(input, size)
    thumbnails.set(key, pending)
    if (thumbnails.size > 128) thumbnails.delete(thumbnails.keys().next().value)
    try { return await pending } finally { if (thumbnails.get(key) === pending) thumbnails.delete(key) }
}
async function createThumbnail(input: string, size: number) {
    const protectedMedia = input.startsWith("freeshow-protected://")
    const video = protectedMedia || /\.(mp4|m4v|mov|webm|mkv|avi|wmv|mpeg|mpg)$/i.test(input)
    if (/\.(mp3|wav|ogg|flac|m4a|aac|wma)$/i.test(input)) return { input, output: input, size }
    const cached = protectedMedia ? null : await invoke<{input:string;output:string;size:number} | null>("media_files", { operation: "THUMBNAIL_CACHE", data: { input, size } })
    if (cached) return cached
    if (!protectedMedia) await invoke("media_files", { operation: "GRANT", data: { path: input } })
    const element = video ? document.createElement("video") : new Image()
    element.crossOrigin = "anonymous"
    let timer: ReturnType<typeof setTimeout>
    let canvas: HTMLCanvasElement | undefined
    try {
        await new Promise<void>((resolve, reject) => {
            timer = setTimeout(() => reject(new Error("Media preview timed out")), 12000)
            element.onerror = () => reject(new Error("Cannot decode this media format"))
            if (element instanceof HTMLVideoElement) { element.muted = true; element.preload = "auto"; element.onloadeddata = () => resolve() }
            else element.onload = () => resolve()
            element.src = protectedMedia ? convertFileSrc(input.slice("freeshow-protected://".length), "freeshow-protected") : convertFileSrc(input)
        })
        const width = element instanceof HTMLVideoElement ? element.videoWidth : element.naturalWidth
        const height = element instanceof HTMLVideoElement ? element.videoHeight : element.naturalHeight
        if (!width || !height) throw new Error("Media has no image dimensions")
        const ratio = Math.min(1, size / Math.max(width, height))
        canvas = document.createElement("canvas")
        canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio))
        canvas.getContext("2d")!.drawImage(element, 0, 0, canvas.width, canvas.height)
        const blob = await new Promise<Blob>((resolve, reject) => canvas!.toBlob(value => value ? resolve(value) : reject(Error("Unable to encode thumbnail")), "image/png"))
        if (protectedMedia) return { input, output: canvas.toDataURL("image/png"), size }
        return await invoke<{input:string;output:string;size:number}>("media_files", { operation: "STORE_THUMBNAIL", data: { input, size, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) } })
    } finally {
        clearTimeout(timer!)
        if (canvas) canvas.width = canvas.height = 0
        element.onerror = null
        if (element instanceof HTMLVideoElement) { element.onloadeddata = null; element.pause(); element.removeAttribute("src"); element.load() }
        else { element.onload = null; element.src = "" }
    }
}
