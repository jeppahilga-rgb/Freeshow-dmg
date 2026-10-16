import { get } from "svelte/store"
import type { CustomFont, Show } from "../../../types/Show"
import { customFonts, activePopup, alertMessage } from "../../stores"
import { isBundledFont } from "../../utils/bundledFonts"
import names from "../../utils/googleFontNames.json"
import { importedFontNames } from "../../utils/importFontNames"
import { confirmCustom } from "../../utils/popup"
import { backendService } from "../../tauri/backendServices"
import { loadCustomFont } from "./fonts"
const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!))
export async function resolveImportedFonts(shows: Show[]): Promise<string[]> {
    if (!(window as any).__TAURI_INTERNALS__) return []
    const warnings: string[] = []
    let installed: string[] = []
    try { const result = await backendService("GOOGLE_FONTS", { action: "inventory" }); if (!Array.isArray(result)) throw Error("Font inventory unavailable"); installed = result }
    catch { warnings.push("Installed fonts could not be checked. Some fonts below may already be installed.") }
    const available = new Set(installed.map(name => name.toLowerCase()))
    available.add("cmgsans")
    const local = [...get(customFonts), ...shows.flatMap(show => show.settings.customFonts || [])]
    for (const font of local) if (font.type === "local" && await loadCustomFont(font)) available.add(font.name.toLowerCase())
    const missing = importedFontNames(shows).filter(name => !isBundledFont(name) && !available.has(name.toLowerCase()))
    if (!missing.length) return warnings
    const downloadable = missing.map(name => names.find(family => family.toLowerCase() === name.toLowerCase())).filter(Boolean) as string[]
    const other = missing.filter(name => !downloadable.some(family => family.toLowerCase() === name.toLowerCase()))
    if (downloadable.length && await confirmCustom(`This presentation uses missing fonts:<br><br>${downloadable.map(escape).join(", ")}<br><br>Download these Google Fonts and keep them offline? The original font names will be preserved.${other.length ? "<br><br>Other missing fonts must be installed separately: " + other.map(escape).join(", ") : ""}`)) {
        activePopup.set("alert")
        for (const name of downloadable) {
            alertMessage.set("Downloading font: " + name)
            try {
                const fonts: CustomFont[] = await backendService("GOOGLE_FONTS", { action: "download", name })
                for (const font of fonts) if (!await loadCustomFont(font)) throw Error("Downloaded font could not be loaded")
                customFonts.update(current => [...current.filter(font => font.name.toLowerCase() !== name.toLowerCase()), ...fonts])
                for (const show of shows) if (importedFontNames(show).some(font => font.toLowerCase() === name.toLowerCase())) show.settings.customFonts = [...(show.settings.customFonts || []).filter(font => font.name.toLowerCase() !== name.toLowerCase()), ...fonts]
            } catch (error) { warnings.push("Could not download " + escape(name) + ": " + escape(String(error))) }
        }
    } else if (downloadable.length) warnings.push("Missing fonts were not downloaded: " + downloadable.map(escape).join(", ") + ". Text wrapping and spacing may differ.")
    if (other.length) warnings.push("Install these missing fonts to preserve text layout: " + other.map(escape).join(", ") + ". They are not in the Google Fonts download catalog.")
    return warnings
}
