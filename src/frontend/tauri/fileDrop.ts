import { get } from "svelte/store"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { activeDrawerTab, audioFolders, drawerTabsData, mediaFolders } from "../stores"
import { audioExtensions, mediaExtensions } from "../values/extensions"
import { droppedImportKind, snapshotDrop, transferDrop } from "./dropTransfer"

export function installFileDrop() {
    if (getCurrentWindow().label !== "main") return
    const replayed = new WeakSet<Event>()
    document.addEventListener("dragover", event => {
        if (Array.from(event.dataTransfer?.items || []).some(item => item.kind === "file")) event.preventDefault()
    }, true)
    document.addEventListener("drop", event => {
        if (replayed.has(event) || !event.dataTransfer) return
        const snapshot = snapshotDrop(event.dataTransfer)
        if (!snapshot.length) return // Internal cards and browser URLs use the existing handlers.
        event.preventDefault()
        event.stopImmediatePropagation()
        const target = event.target as HTMLElement
        const area = target.closest?.("[data-drop-area]")?.getAttribute("data-drop-area")
        const drawer = get(activeDrawerTab) || "shows"
        const status = document.getElementById("tauri-status")
        if (status) status.textContent = "Importing dropped files…"
        void (async () => {
            const { files, root } = await transferDrop(snapshot)
            const media: File[] = []
            const imports = new Map<string, string[]>()
            const unknown: string[] = []
            for (const file of files) {
                const extension = file.name.split(".").pop()?.toLowerCase() || ""
                if ((file as any).isDirectory || mediaExtensions.includes(extension) || audioExtensions.includes(extension)) media.push(file)
                else {
                    const kind = droppedImportKind(file.name, drawer)
                    if (kind) imports.set(kind, [...(imports.get(kind) || []), window.api.showFilePath(file)])
                    else unknown.push(file.name)
                }
            }
            for (const [id, paths] of imports) window.api.send("MAIN", { channel: "IMPORT_FILES", data: { id, paths } })
            if (media.length) {
                const libraryDrop = (!area && !target.closest?.(".timeline-track-wrapper")) || area === "navigation"
                const folderDrop = media.some(file => (file as any).isDirectory)
                if (libraryDrop || (folderDrop && area !== "project")) {
                    const { addDrawerFolder } = await import("../components/helpers/dropActions")
                    const type = drawer === "audio" || media.every(file => audioExtensions.includes(file.name.split(".").pop()?.toLowerCase() || "")) ? "audio" : "media"
                    const folders = folderDrop && media.every(file => (file as any).isDirectory) ? media : [{ name: "Dropped files", path: root }]
                    for (const folder of folders) addDrawerFolder(folder, type)
                    activeDrawerTab.set(type)
                    const folderPath = window.api.showFilePath(folders[0] as File)
                    const id = Object.entries(get(type === "audio" ? audioFolders : mediaFolders)).find(([, folder]) => folder.path === folderPath)?.[0]
                    if (id) drawerTabsData.update(tabs => ({ ...tabs, [type]: { ...tabs[type], activeSubTab: id } }))
                } else {
                    const drop = new DragEvent("drop", { clientX: event.clientX, clientY: event.clientY, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey, bubbles: true, cancelable: true })
                    // Keep the resolved File objects: DataTransfer can create wrappers that lose custom paths.
                    Object.defineProperty(drop, "dataTransfer", { value: { files: media, items: media.map(file => ({ kind: "file", type: file.type, getAsFile: () => file })), getData: () => "" } })
                    replayed.add(drop)
                    target.dispatchEvent(drop)
                }
            }
            if (unknown.length) window.api.send("MAIN", { channel: "ALERT", data: "No automatic drop converter for: " + unknown.join(", ") + ". Choose the matching format under Import." })
            if (status?.textContent === "Importing dropped files…") status.textContent = "Dropped files saved in your data folder/Imports/Dropped"
        })().catch(error => window.api.send("MAIN", { channel: "ALERT", data: "File drop failed: " + String(error) }))
    }, true)
}
