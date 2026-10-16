import type { LyricSearchResult } from "../../types/Main"

const cache = new Map<string, { expires: number; value: any }>()
const pending = new Map<string, Promise<any>>()
async function request(path: string) {
    const saved = cache.get(path)
    if (saved && saved.expires > Date.now()) return saved.value
    if (pending.has(path)) return pending.get(path)
    const task = (async () => {
        const response = await fetch(`https://lrclib.net/api/${path}`, { signal: AbortSignal.timeout(12000) })
        if (response.status === 429) throw new Error("Lyrics service is temporarily rate-limited. Please wait a moment and search again.")
        if (!response.ok) throw new Error(`Lyrics service returned ${response.status}. Please try again later.`)
        const value = await response.json()
        if (cache.size >= 100) cache.delete(cache.keys().next().value!)
        cache.set(path, { expires: Date.now() + 300000, value })
        return value
    })()
    pending.set(path, task)
    try { return await task } finally { pending.delete(path) }
}
export async function searchLyrics({ title, artist = "" }: { title: string; artist?: string }): Promise<LyricSearchResult[]> {
    title = title.trim()
    artist = artist.trim()
    if (!title) return []
    // The UI has one search field: it may contain both title and artist.
    const query = new URLSearchParams(artist ? { track_name: title, artist_name: artist } : { q: title })
    const songs = await request(`search?${query}`)
    return songs.filter(song => song.plainLyrics || song.syncedLyrics).map(song => ({ source: "LRCLIB", key: String(song.id), title: song.trackName, artist: song.artistName, originalQuery: title }))
}
export async function getLyrics(song: LyricSearchResult) {
    if (song.source !== "LRCLIB" || !/^\d+$/.test(song.key)) throw new Error("Search again to select a supported lyrics result")
    const record = await request(`get/${song.key}`)
    const lyrics = record.plainLyrics || (record.syncedLyrics || "").replace(/^\[[^\]]+\]\s*/gm, "")
    return { lyrics, source: "LRCLIB", title: record.trackName, artist: record.artistName }
}
