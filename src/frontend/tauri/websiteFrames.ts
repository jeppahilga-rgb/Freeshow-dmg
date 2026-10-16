// A source frame is fetched and decoded once per renderer, then drawn by all
// its visible consumers. Never keep an unbounded history of decoded frames.
export function createWebsiteFramePool() {
    const sources = new Map<string, { users: Set<string>; bitmap?: ImageBitmap; pending?: Promise<void>; updated: number }>()
    return {
        async draw(url: string, id: string, load: () => Promise<ArrayBuffer>, draw: (bitmap: ImageBitmap) => void) {
            let source = sources.get(url)
            if (!source) { source = { users: new Set(), updated: -Infinity }; sources.set(url, source) }
            source.users.add(id)
            const entry = source
            if (!entry.pending && (!entry.bitmap || performance.now() - entry.updated >= 30)) {
                entry.pending = (async () => {
                    const bytes = await load()
                    if (!bytes.byteLength) { entry.updated=performance.now();return }
                    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }))
                    if (sources.get(url) !== entry) { bitmap.close(); return }
                    entry.bitmap?.close()
                    entry.bitmap = bitmap
                    entry.updated = performance.now()
                })().finally(() => { entry.pending = undefined })
            }
            await entry.pending
            if (sources.get(url) === entry && entry.users.has(id) && entry.bitmap) draw(entry.bitmap)
        },
        release(url: string, id: string) {
            const source = sources.get(url)
            if (!source) return
            source.users.delete(id)
            if (!source.users.size) { sources.delete(url); source.bitmap?.close() }
        }
    }
}
