import { beforeEach, expect, it, vi } from "vitest"
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke, convertFileSrc: (path: string) => path }))
import { mediaThumbnail } from "./media"

let canvas: any
beforeEach(() => {
    vi.resetAllMocks()
    class Video {}
    class Picture {
        naturalWidth = 4000
        naturalHeight = 2000
        onload: any
        onerror: any
        set src(value: string) { if (value) queueMicrotask(() => this.onload?.()) }
    }
    vi.stubGlobal("HTMLVideoElement", Video)
    vi.stubGlobal("Image", Picture)
    canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob: (callback: any) => callback(new Blob(["PNG fixture"])) }
    vi.stubGlobal("document", { createElement: vi.fn(() => canvas) })
    invoke.mockImplementation(async (_command, args) => args.operation === "STORE_THUMBNAIL" ? { input: args.data.input, size: args.data.size, output: "C:/cache/media-cache/thumb.png" } : null)
})

it("returns an existing disk thumbnail without decoding the original", async () => {
    invoke.mockResolvedValue({ input: "C:/cached.jpg", output: "C:/cache/media-cache/existing.png", size: 250 })
    expect((await mediaThumbnail("C:/cached.jpg")).output).toContain("existing.png")
    expect(document.createElement).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledOnce()
})

it("persists generated pixels and releases the canvas instead of caching base64", async () => {
    const result = await mediaThumbnail("C:/new.jpg")
    expect(result.output).toBe("C:/cache/media-cache/thumb.png")
    expect(invoke.mock.calls.map(([, args]) => args.operation)).toEqual(["THUMBNAIL_CACHE", "GRANT", "STORE_THUMBNAIL"])
    expect(canvas.width).toBe(0)
    expect(canvas.height).toBe(0)
    await mediaThumbnail("C:/new.jpg")
    expect(invoke.mock.calls.filter(([, args]) => args.operation === "THUMBNAIL_CACHE")).toHaveLength(2)
})

it("revalidates completed thumbnails when the source is replaced", async () => {
    invoke.mockResolvedValueOnce({ input: "C:/replace.jpg", output: "C:/old.png", size: 250 })
    expect((await mediaThumbnail("C:/replace.jpg")).output).toBe("C:/old.png")
    invoke.mockResolvedValueOnce({ input: "C:/replace.jpg", output: "C:/new.png", size: 250 })
    expect((await mediaThumbnail("C:/replace.jpg")).output).toBe("C:/new.png")
})
