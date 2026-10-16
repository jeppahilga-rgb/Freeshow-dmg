import { beforeEach, describe, expect, it, vi } from "vitest"

const { invoke, importDocument } = vi.hoisted(() => ({ invoke: vi.fn(), importDocument: vi.fn() }))
vi.mock("./documentImport", () => ({ importDocument }))
vi.mock("@tauri-apps/api/core", () => ({ invoke }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }))
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }))
vi.mock("./screenCapture", () => ({ installScreenCapture: vi.fn(async () => {}), screenSources: vi.fn() }))
vi.mock("./media", () => ({ mediaThumbnail: vi.fn() }))
vi.mock("./lyrics", () => ({ searchLyrics: vi.fn(), getLyrics: vi.fn() }))
vi.mock("../../electron/data/defaults", () => ({ defaultSettings: {}, defaultSyncedSettings: {} }))
import { installTauriBridge } from "./bridge"
import { searchLyrics, getLyrics } from "./lyrics"

beforeEach(async () => {
    invoke.mockReset()
    importDocument.mockReset()
    vi.stubGlobal("window", { addEventListener: vi.fn() })
    vi.stubGlobal("document", {
        addEventListener: vi.fn(), getElementById: () => null,
        createElement: () => ({ style: {} }), body: { style: {}, append: vi.fn() }
    })
    await installTauriBridge()
})

describe("Tauri library protocol", () => {
    it.each(["SEARCH_LYRICS", "GET_LYRICS"])("preserves %s errors instead of returning empty lyrics", async channel => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        vi.mocked(channel === "SEARCH_LYRICS" ? searchLyrics : getLyrics).mockRejectedValueOnce(Error("Lyrics service is rate-limited"))
        const receive = vi.fn()
        window.api.receive("MAIN", receive, "lyrics-error")
        window.api.send("MAIN", { channel, data: { title: "Hossana", song: {} } }, "lyrics-error")
        await vi.waitFor(() => expect(receive).toHaveBeenCalledWith({ channel, data: { error: "Error: Lyrics service is rate-limited" } }, "lyrics-error"))
        warn.mockRestore()
    })
    it("returns the available content provider list without an unsupported alert", async () => {
        const providers = [{ id: "test-provider", name: "Test provider" }]
        invoke.mockResolvedValue(providers)
        const receive = vi.fn()
        window.api.receive("MAIN", receive, "providers")
        window.api.send("MAIN", { channel: "GET_CONTENT_PROVIDERS" }, "providers")
        await vi.waitFor(() => expect(receive).toHaveBeenCalledWith({ channel: "GET_CONTENT_PROVIDERS", data: providers }, "providers"))
        expect(invoke).toHaveBeenCalledWith("backend_service", { operation: "GET_CONTENT_PROVIDERS", data: null })
        expect(receive.mock.calls.some(([message]) => message.channel === "ALERT")).toBe(false)
    })
    it.each(["pdf"])("imports %s as rendered slide backgrounds", async kind => {
        importDocument.mockImplementation(async (_path, progress) => { progress(50); return { images: ["C:/Imports/page-1.png"], name: "Deck" } })
        const receive = vi.fn()
        window.api.receive("MAIN", receive)
        window.api.send("MAIN", { channel: "IMPORT_FILES", data: { id: kind, paths: ["C:/Deck." + (kind === "pdf" ? "pdf" : "pptx")] } })
        await vi.waitFor(() => expect(receive).toHaveBeenCalledWith({ channel: "IMAGES_TO_SHOW", data: { images: ["C:/Imports/page-1.png"], name: "Deck" } }, undefined))
        expect(receive).toHaveBeenCalledWith(expect.objectContaining({ channel: "PDF_IMPORT_PROGRESS", data: expect.objectContaining({ status: "complete" }) }), undefined)
    })
    it("shows an alert when an asynchronous import converter fails", async () => {
        invoke.mockResolvedValue({ content: "invalid content" })
        const alerts = vi.fn()
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        window.api.receive("MAIN", message => {
            if (message.channel === "IMPORT2") return Promise.reject(Error("Unable to convert this presentation"))
            if (message.channel === "ALERT") alerts(message.data)
        })
        window.api.send("MAIN", { channel: "IMPORT_FILES", data: { id: "txt", paths: ["C:\\Slides\\Deck.txt"] } })
        await vi.waitFor(() => expect(alerts).toHaveBeenCalledWith(expect.stringContaining("Unable to convert this presentation")))
        warn.mockRestore()
    })
    it("parses native PowerPoint parts before dispatching the converter", async () => {
        invoke.mockResolvedValue({ xml: { "ppt/presentation.xml": '<p:presentation xmlns:p="p"><p:sldSz cx="100" cy="100"/></p:presentation>' }, contentPaths: {} })
        const receive = vi.fn()
        window.api.receive("MAIN", receive)
        window.api.send("MAIN", { channel: "IMPORT_FILES", data: { id: "powerpoint", paths: ["C:\\Slides\\Deck.pptx"] } })
        await vi.waitFor(() => expect(receive).toHaveBeenCalledWith({ channel: "IMPORT2", data: { channel: "powerpoint", data: [{ name: "Deck", content: expect.objectContaining({ "ppt/presentation.xml": expect.any(Array), contentPaths: {} }) }] } }, undefined))
        expect(invoke).toHaveBeenCalledWith("import_powerpoint", { path: "C:\\Slides\\Deck.pptx" })
    })
    it("returns Bible data with the awaiting listener ID", async () => {
        invoke.mockResolvedValue({ id: "bible", content: ["bible", { books: [] }] })
        const receive = vi.fn()
        window.api.receive("MAIN", receive, "bible-request")
        window.api.send("MAIN", { channel: "BIBLE", data: { id: "bible", name: "Example" } }, "bible-request")
        await vi.waitFor(() => expect(receive).toHaveBeenCalledWith({ channel: "BIBLE", data: { id: "bible", content: ["bible", { books: [] }] } }, "bible-request"))
        expect(invoke).toHaveBeenCalledWith("library_service", { operation: "BIBLE", data: { id: "bible", name: "Example" } })
    })
    it("routes text import into the original frontend converter protocol", async () => {
        invoke.mockResolvedValue({ content: "Verse one\nVerse two" })
        const receive = vi.fn()
        window.api.receive("MAIN", receive)
        window.api.send("MAIN", { channel: "IMPORT_FILES", data: { id: "txt", paths: ["C:\\Songs\\Song.txt"] } })
        await vi.waitFor(() => expect(receive).toHaveBeenCalledWith({ channel: "IMPORT2", data: { channel: "txt", data: [{ content: "Verse one\nVerse two", path: "C:\\Songs\\Song.txt", name: "Song", extension: "txt" }] } }, undefined))
    })
    it("does not send unsupported binary imports to text converters", async () => {
        const receive = vi.fn()
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        window.api.receive("MAIN", receive)
        window.api.send("MAIN", { channel: "IMPORT_FILES", data: { id: "txt", paths: ["C:\\Songs\\Song.zip"] } })
        await vi.waitFor(() => expect(warn).toHaveBeenCalled())
        expect(invoke).not.toHaveBeenCalled()
        expect(receive).toHaveBeenCalledWith({ channel: "ALERT", data: expect.stringContaining("Import failed:") }, undefined)
        warn.mockRestore()
    })
    it("routes exports to Rust and only reports completion after success", async () => {
        invoke.mockResolvedValue({ files: ["C:\\Exports\\Example.fsstage"] })
        const receive = vi.fn()
        window.api.receive("MAIN", receive)
        const msg = { channel: "STAGE_LAYOUT", data: { content: { id: "stage" }, name: "Example" } }
        window.api.send("EXPORT", msg)
        await vi.waitFor(() => expect(receive).toHaveBeenCalledWith({ channel: "TOAST", data: "actions.exported" }, undefined))
        expect(invoke).toHaveBeenCalledWith("export_library", { msg })
    })
    it("routes Spotify state and controls to the native service", async () => {
        const state = { title: "Track", artist: "Artist", isPlaying: true }
        invoke.mockResolvedValue(state)
        const receive = vi.fn()
        window.api.receive("MAIN", receive, "spotify-state")
        window.api.send("MAIN", { channel: "SPOTIFY_GET_STATE" }, "spotify-state")
        await vi.waitFor(() => expect(receive).toHaveBeenCalledWith({ channel: "SPOTIFY_GET_STATE", data: state }, "spotify-state"))
        expect(invoke).toHaveBeenCalledWith("spotify_service", { command: "state", value: null })
        window.api.send("MAIN", { channel: "SPOTIFY_COMMAND", data: { command: "seek", value: 12 } })
        await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("spotify_service", { command: "seek", value: 12 }))
    })
    it("does not report a failed export as completed", async () => {
        invoke.mockRejectedValue(Error("Export directory is unavailable"))
        const receive = vi.fn()
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        window.api.receive("MAIN", receive)
        window.api.send("EXPORT", { channel: "STAGE_LAYOUT", data: { content: {} } })
        await vi.waitFor(() => expect(warn).toHaveBeenCalled())
        expect(receive).toHaveBeenCalledWith({ channel: "ALERT", data: expect.stringContaining("Export directory is unavailable") }, undefined)
        expect(receive).not.toHaveBeenCalledWith(expect.objectContaining({ channel: "TOAST" }), undefined)
        warn.mockRestore()
    })
})
