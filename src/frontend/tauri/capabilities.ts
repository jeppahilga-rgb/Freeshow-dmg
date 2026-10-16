export const tauriImportKinds = new Set([
    "freeshow", "freeshow_template", "freeshow_overlay", "freeshow_theme", "freeshow_action", "freeshow_stage", "freeshow_project",
    "txt", "chordpro", "csv", "videopsalm", "opensong", "songbeamer", "easyslides", "verseview", "calendar", "lessons", "BIBLE",
    "pdf", "powerpoint", "powerpoint_editable", "powerpoint_pdf", "word", "propresenter", "easyworship", "openlp", "mediashout", "quelea", "softprojector"
])
export function canImportHere(kind: string) {
    return typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__ || tauriImportKinds.has(kind)
}
export function canExportHere(kind: string) {
    return typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__ || ["show", "txt", "project", "pdf", "image"].includes(kind)
}
