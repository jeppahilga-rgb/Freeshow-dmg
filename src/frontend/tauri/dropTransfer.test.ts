import { File } from "node:buffer"
import { beforeEach, expect, it, vi } from "vitest"
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke }))
import { droppedImportKind, transferDrop } from "./dropTransfer"
beforeEach(() => {
    vi.stubGlobal("File", File)
    invoke.mockReset()
    invoke.mockImplementation(async (_, { request }) => request.action === "start" ? { token: "test", path: "C:/Library/Imports/Dropped/test" } : null)
})
it("copies multiple binary files in bounded chunks and resolves usable paths", async () => {
    const bytes = new Uint8Array(256 * 1024 + 7).fill(213)
    const file = new File([bytes], "clip.mp4", { type: "video/mp4" }) as unknown as globalThis.File
    const empty = new File([], "empty.txt") as unknown as globalThis.File
    const result = await transferDrop([{ file, entry: null }, { file: empty, entry: null }])
    const chunks = invoke.mock.calls.map(([, args]) => args.request).filter(r => r.action === "append")
    expect(chunks.map(r => [r.relative, r.offset, r.bytes.length])).toEqual([["clip.mp4", 0, 256 * 1024], ["clip.mp4", 256 * 1024, 7], ["empty.txt", 0, 0]])
    expect(chunks[1].bytes).toEqual(Array(7).fill(213))
    expect((result.files[0] as any).path).toBe("C:/Library/Imports/Dropped/test/clip.mp4")
    expect(result.files[0].type).toBe("video/mp4")
    expect(invoke.mock.calls.at(-1)?.[1].request.action).toBe("finish")
})
it("cancels partial transfers when writing fails", async () => {
    invoke.mockImplementation(async (_, { request }) => {
        if (request.action === "start") return { token: "test", path: "C:/Library/Imports/Dropped/test" }
        if (request.action === "append") throw Error("Disk full")
    })
    await expect(transferDrop([{ file: new File(["test"], "test.txt") as unknown as globalThis.File, entry: null }])).rejects.toThrow("Disk full")
    expect(invoke.mock.calls.at(-1)?.[1].request.action).toBe("cancel")
})
it("routes show, PowerPoint, audio-independent and overlay imports by extension", () => {
    expect(droppedImportKind("Deck.PPTX")).toBe("powerpoint")
    expect(droppedImportKind("Song.show")).toBe("freeshow")
    expect(droppedImportKind("Notice.fsoverlay")).toBe("freeshow_overlay")
    expect(droppedImportKind("Visuals.json", "overlays")).toBe("freeshow_overlay")
    expect(droppedImportKind("Template.fstemplate")).toBe("freeshow_template")
    expect(droppedImportKind("clip.mp4")).toBeNull()
})
it("reads every directory batch and preserves nested folder structure", async () => {
    let batch = 0
    const child = { name: "Image.svg", isDirectory: false, file: (ok: (file: any) => void) => ok(new File(["<svg/>"], "Image.svg", { type: "image/svg+xml" })) }
    const entry = { name: "Media folder", isDirectory: true, createReader: () => ({ readEntries: (ok: (files: any[]) => void) => ok(batch++ === 0 ? [child] : []) }) }
    const result = await transferDrop([{ file: null, entry }])
    expect(invoke).toHaveBeenCalledWith("dropped_files", { request: { action: "directory", token: "test", relative: "Media folder" } })
    expect(invoke.mock.calls.find(([,args]) => args.request.action === "append")?.[1].request.relative).toBe("Media folder/Image.svg")
    expect((result.files[0] as any).isDirectory).toBe(true)
})
