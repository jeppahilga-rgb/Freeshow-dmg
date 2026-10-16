import { get } from "svelte/store"
import { shows, showsCache } from "../stores"

// Playback changes usage metadata, not presentation content. Publishing the entire
// content store here rerenders every slide and runs library-wide dirty comparisons.
export function recordShowUse(id: string, used = Date.now()) {
    const show = get(showsCache)[id]
    if (!show) return
    const timestamps = { created: 0, modified: null, ...show.timestamps, used }
    show.timestamps = timestamps
    const index = get(shows)
    if (!index[id]) return
    shows.set({ ...index, [id]: { ...index[id], timestamps } })
}
