import { beforeEach, expect, it, vi } from "vitest"
import { get } from "svelte/store"
vi.mock("../stores", async () => {
    const { writable } = await import("svelte/store")
    return { shows: writable({}), showsCache: writable({}) }
})
import { shows, showsCache } from "../stores"
import { recordShowUse } from "../utils/showUsage"
beforeEach(() => {
    shows.set({ test: { name: "Test", timestamps: { created: 1, modified: 2, used: null } } } as any)
    showsCache.set({ test: { name: "Test", timestamps: { created: 1, modified: 2, used: null }, slides: { first: { items: [{ type: "text" }] } } } } as any)
})
it("records repeated slide use without notifying content subscribers or changing modified time", () => {
    const subscriber = vi.fn()
    const unsubscribe = showsCache.subscribe(subscriber)
    subscriber.mockClear()
    const slides = get(showsCache).test.slides
    for (let used = 10; used < 110; used++) recordShowUse("test", used)
    expect(subscriber).not.toHaveBeenCalled()
    expect(get(showsCache).test.slides).toBe(slides)
    expect(get(showsCache).test.timestamps).toEqual({ created: 1, modified: 2, used: 109 })
    expect(get(shows).test.timestamps.used).toBe(109)
    unsubscribe()
})
it("ignores absent shows without creating phantom entries", () => {
    recordShowUse("missing", 100)
    expect(get(showsCache).missing).toBeUndefined()
    expect(get(shows).missing).toBeUndefined()
})
