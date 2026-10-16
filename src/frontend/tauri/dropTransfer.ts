import { invoke } from "@tauri-apps/api/core"

type Entry = { name: string; isDirectory: boolean; file?: (ok: (file: File) => void, fail: (error: any) => void) => void; createReader?: () => { readEntries: (ok: (entries: Entry[]) => void, fail: (error: any) => void) => void } }
export type DropSnapshot = { file: File | null; entry: Entry | null }[]
// Keep one native transaction open while generating pages, without retaining
// every page image in JavaScript memory.
export async function beginDropTransfer() {
    const batch = await invoke<{ token: string; path: string }>("dropped_files", { request: { action: "start" } })
    let finished = false
    const request = (action: string, extra = {}) => invoke("dropped_files", { request: { action, token: batch.token, ...extra } })
    return {
        async append(file: File) {
            if (finished) throw Error("Import transaction already closed")
            for (let offset = 0; offset < file.size || offset === 0; offset += 256 * 1024) {
                const bytes = Array.from(new Uint8Array(await file.slice(offset, offset + 256 * 1024).arrayBuffer()))
                await request("append", { relative: file.name, offset, bytes })
            }
            return batch.path + "/" + file.name
        },
        async finish() { await request("finish"); finished = true },
        async cancel() { if (!finished) { await request("cancel"); finished = true } }
    }
}
export function snapshotDrop(transfer: DataTransfer): DropSnapshot {
    const items = Array.from(transfer.items || []).filter(item => item.kind === "file")
    return items.length ? items.map(item => ({ file: item.getAsFile(), entry: item.webkitGetAsEntry?.() as Entry | null })) : Array.from(transfer.files).map(file => ({ file, entry: null }))
}
export async function transferDrop(snapshot: DropSnapshot): Promise<{ files: File[]; root: string | null }> {
    const contents: { file: File; relative: string }[] = []
    const roots: { file: File; relative: string; folder: boolean }[] = []
    const directories: string[] = []
    let count = 0
    async function walk(entry: Entry, relative: string, depth = 0) {
        if (++count > 10000 || depth > 32) throw Error("Dropped folder contains too many entries")
        if (entry.isDirectory) {
            directories.push(relative)
            const reader = entry.createReader!()
            while (true) {
                const entries = await new Promise<Entry[]>((resolve, reject) => reader.readEntries(resolve, reject))
                if (!entries.length) break
                for (const child of entries) await walk(child, relative + "/" + child.name, depth + 1)
            }
        } else {
            const file = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject))
            contents.push({ file, relative })
            return file
        }
    }
    for (const item of snapshot) {
        if (item.entry?.isDirectory) {
            await walk(item.entry, item.entry.name)
            roots.push({ file: new File([], item.entry.name), relative: item.entry.name, folder: true })
        } else if (item.file) {
            contents.push({ file: item.file, relative: item.file.name })
            roots.push({ file: item.file, relative: item.file.name, folder: false })
        }
    }
    if (!roots.length) throw Error("No readable files in this drop")
    if (contents.reduce((size, item) => size + item.file.size, 0) > 8 * 1024 ** 3) throw Error("Dropped files exceed the 8 GB transfer limit")
    const batch = await invoke<{ token: string; path: string }>("dropped_files", { request: { action: "start" } })
    const request = (action: string, extra = {}) => invoke("dropped_files", { request: { action, token: batch.token, ...extra } })
    try {
        for (const relative of directories) await request("directory", { relative })
        for (const { file, relative } of contents) {
            for (let offset = 0; offset < file.size || offset === 0; offset += 256 * 1024) {
                const bytes = Array.from(new Uint8Array(await file.slice(offset, offset + 256 * 1024).arrayBuffer()))
                await request("append", { relative, offset, bytes })
            }
        }
        const files = roots.map(({ file, relative, folder }) => {
            const resolved = new File([], file.name, { type: file.type, lastModified: file.lastModified })
            Object.defineProperty(resolved, "path", { value: batch.path + "/" + relative })
            Object.defineProperty(resolved, "isDirectory", { value: folder })
            return resolved
        })
        await request("finish")
        return { files, root: batch.path }
    } catch (error) {
        await request("cancel").catch(() => {})
        throw error
    }
}

export function droppedImportKind(name: string, drawer = "shows"): string | null {
    const extension = name.split(".").pop()?.toLowerCase() || ""
    const kinds: Record<string, string> = {
        show: "freeshow", project: "freeshow_project", shows: "freeshow_project",
        fstemplate: "freeshow_template", fst: "freeshow_template", template: "freeshow_template",
        fsoverlay: "freeshow_overlay", fso: "freeshow_overlay", overlay: "freeshow_overlay",
        fsaction: "freeshow_action", action: "freeshow_action", fsstage: "freeshow_stage", stage: "freeshow_stage",
        fstheme: "freeshow_theme", theme: "freeshow_theme", pptx: "powerpoint", ppt: "powerpoint",
        txt: "txt", csv: "csv", cho: "chordpro", crd: "chordpro", chopro: "chordpro", chordpro: "chordpro", chord: "chordpro", onsong: "chordpro", sng: "songbeamer",
        pdf: "pdf", doc: "word", docx: "word", zip: "freeshow_project"
    }
    if (extension === "json") return ({ overlays: "freeshow_overlay", templates: "freeshow_template", scripture: "BIBLE" })[drawer] || "freeshow"
    return kinds[extension] || null
}
