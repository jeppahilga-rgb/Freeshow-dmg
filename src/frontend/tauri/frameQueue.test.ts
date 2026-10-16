import { afterEach, expect, it, vi } from "vitest"
import { frameQueue } from "../utils/frameQueue"

afterEach(() => vi.unstubAllGlobals())
function fixture() {
    let callback: FrameRequestCallback | undefined
    const request = vi.fn((cb: FrameRequestCallback) => { callback = cb; return 1 })
    const cancel = vi.fn(() => { callback = undefined })
    vi.stubGlobal("requestAnimationFrame", request)
    vi.stubGlobal("cancelAnimationFrame", cancel)
    return { request, cancel, run: () => callback?.(0) }
}
it("runs geometry once for a burst, using the latest pointer position", () => {
    const clock = fixture(), apply = vi.fn(), queue = frameQueue(apply)
    for (let x = 0; x < 100; x++) queue.push({ x })
    expect(apply).not.toHaveBeenCalled()
    expect(clock.request).toHaveBeenCalledTimes(1)
    clock.run()
    expect(apply).toHaveBeenCalledExactlyOnceWith({ x: 99 })
})
it("flushes the final position on release without a late duplicate", () => {
    const clock = fixture(), apply = vi.fn(), queue = frameQueue(apply)
    queue.push(10); queue.push(20); queue.flush(); clock.run()
    expect(apply).toHaveBeenCalledExactlyOnceWith(20)
    queue.push(30); clock.run()
    expect(apply).toHaveBeenLastCalledWith(30)
})
it("discards pending updates when the editor is destroyed", () => {
    const clock = fixture(), apply = vi.fn(), queue = frameQueue(apply)
    queue.push(10); queue.cancel(); clock.run(); queue.flush()
    expect(apply).not.toHaveBeenCalled()
})
