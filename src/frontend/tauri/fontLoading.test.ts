import { expect, it, vi } from "vitest"
import { loadFontOnce, loadFontWithFallback } from "../utils/fontLoading"

it("shares pending and completed font loads across repeated slides", async () => {
    const load = vi.fn(async () => true)
    expect(await Promise.all(Array.from({ length: 100 }, () => loadFontOnce("test-font", load)))).toEqual(Array(100).fill(true))
    expect(load).toHaveBeenCalledOnce()
    expect(await loadFontOnce("test-font", load)).toBe(true)
    expect(load).toHaveBeenCalledOnce()
})
it("backs off failed fonts but permits a later retry", async () => {
    vi.useFakeTimers()
    const load = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    expect(await loadFontOnce("failed-font", load)).toBe(false)
    expect(await loadFontOnce("failed-font", load)).toBe(false)
    expect(load).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(30001)
    expect(await loadFontOnce("failed-font", load)).toBe(true)
    expect(load).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
})
it("tries the fallback when a local font reports failure without throwing", async () => {
    const fallback=vi.fn(async()=>true)
    expect(await loadFontWithFallback(async()=>false,fallback)).toBe(true)
    expect(fallback).toHaveBeenCalledOnce()
})
it("keeps a successfully loaded local font", async () => {
    const fallback=vi.fn(async()=>false)
    expect(await loadFontWithFallback(async()=>true,fallback)).toBe(true)
    expect(fallback).not.toHaveBeenCalled()
})
