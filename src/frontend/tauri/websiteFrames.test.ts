import { afterEach, expect, it, vi } from "vitest"
import { createWebsiteFramePool } from "./websiteFrames"
afterEach(()=>vi.unstubAllGlobals())
it("reuses the decoded frame when the source reports no newer frame",async()=>{
    let now=0
    vi.stubGlobal("performance",{now:()=>now})
    const bitmap={close:vi.fn()},decode=vi.fn(async()=>bitmap),draw=vi.fn()
    vi.stubGlobal("createImageBitmap",decode)
    const load=vi.fn().mockResolvedValueOnce(new Uint8Array([1]).buffer).mockResolvedValue(new ArrayBuffer(0))
    const pool=createWebsiteFramePool()
    await pool.draw("site","one",load,draw);now=100
    await pool.draw("site","one",load,draw)
    expect(decode).toHaveBeenCalledTimes(1);expect(draw.mock.calls[1][0]).toBe(bitmap)
    pool.release("site","one");expect(bitmap.close).toHaveBeenCalledTimes(1)
})
it("shares capture and decoding between concurrent mirrors and releases the last frame",async()=>{
    const bitmap={close:vi.fn()},decode=vi.fn(async()=>bitmap),load=vi.fn(async()=>new Uint8Array([1]).buffer)
    vi.stubGlobal("createImageBitmap",decode)
    const pool=createWebsiteFramePool(),draw=vi.fn()
    await Promise.all([pool.draw("site","one",load,draw),pool.draw("site","two",load,draw)])
    expect(load).toHaveBeenCalledTimes(1);expect(decode).toHaveBeenCalledTimes(1);expect(draw).toHaveBeenCalledTimes(2)
    pool.release("site","one");expect(bitmap.close).not.toHaveBeenCalled()
    pool.release("site","two");expect(bitmap.close).toHaveBeenCalledTimes(1)
})
it("closes a frame that finishes decoding after its consumer is removed",async()=>{
    let finish:(bitmap:any)=>void=()=>{}
    const bitmap={close:vi.fn()},draw=vi.fn()
    vi.stubGlobal("createImageBitmap",()=>new Promise(resolve=>{finish=resolve}))
    const pool=createWebsiteFramePool()
    const pending=pool.draw("site","one",async()=>new Uint8Array([1]).buffer,draw)
    await Promise.resolve();pool.release("site","one");finish(bitmap);await pending
    expect(bitmap.close).toHaveBeenCalledTimes(1);expect(draw).not.toHaveBeenCalled()
})
