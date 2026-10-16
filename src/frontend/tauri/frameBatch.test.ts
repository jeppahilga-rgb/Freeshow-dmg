import { expect, it, vi } from "vitest"
import { hasNewerMicrotask, runSlidePlayback } from "../utils/frameBatch"

it("publishes only the newest synchronous output update without waiting for a timer", async () => {
    const jobs = Array.from({ length: 100 }, () => hasNewerMicrotask("output-test"))
    expect(await Promise.all(jobs)).toEqual([...Array(99).fill(true), false])
})
it("keeps content-before-output ordering and independent batches", async () => {
    const seen: string[] = []
    const content = hasNewerMicrotask("content-test").then(skip => { if (!skip) seen.push("content") })
    const output = hasNewerMicrotask("output-order-test").then(skip => { if (!skip) seen.push("output") })
    await Promise.all([content, output])
    expect(seen).toEqual(["content", "output"])
    expect(await hasNewerMicrotask("content-test")).toBe(false)
})
it("plays ordinary slides synchronously while preserving timer-based custom action ordering", () => {
    vi.useFakeTimers()
    const seen: string[] = []
    runSlidePlayback(false, () => seen.push("ordinary"))
    expect(seen).toEqual(["ordinary"])
    setTimeout(() => seen.push("action"))
    runSlidePlayback(true, () => seen.push("action-slide"))
    expect(seen).toEqual(["ordinary"])
    vi.runAllTimers()
    expect(seen).toEqual(["ordinary", "action", "action-slide"])
    vi.useRealTimers()
})
