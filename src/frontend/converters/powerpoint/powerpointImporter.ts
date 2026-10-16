import { get } from "svelte/store"
import { uid } from "uid"
import type { Show, Slide, SlideData } from "../../../types/Show"
import { ShowObj } from "../../classes/Show"
import { checkName } from "../../components/helpers/show"
import { loadCustomFont } from "../../components/helpers/fonts"
import { resolveImportedFonts } from "../../components/helpers/importFonts"
import { activePopup, alertMessage, drawerTabsData } from "../../stores"
import { translateText } from "../../utils/language"
import { createCategory, setTempShows } from "../importHelpers"
import { PowerPointPackage } from "./PowerPointHelper"

// missing shapes/tables/graphs
// item/line background, some text color incorrect
// extract embedded videos/audio

export async function convertPowerpoint(files: any[]) {
    activePopup.set("alert")
    alertMessage.set("popup.importing")

    // use selected category (or Presentation if no specific is selected)
    let categoryId = get(drawerTabsData).shows?.activeSubTab
    if (categoryId === "all" || categoryId === "unlabeled") categoryId = createCategory("presentation", "presentation", { isDefault: true })

    const tempShows: any[] = []
    const warnings = new Set<string>()

    await new Promise(resolve => setTimeout(resolve, 10))
    {
        for (const { name, content } of files) {
            // console.log("PPT", content)

            let pkg: PowerPointPackage
            try {
                pkg = new PowerPointPackage(content)
            } catch {
                throw new Error("Unable to read PowerPoint presentation: " + name)
            }
            const presentationPart = pkg.getPresentation()
            if (!presentationPart) throw new Error("PowerPoint presentation has no readable slide list")

            // load font faces
            const contentPaths = content.contentPaths || {}
            // loadAllFonts(contentPaths)
            const fonts = getAllFontNames(contentPaths)
            const loadedFonts = await Promise.all(fonts.map(loadCustomFont))
            if (loadedFonts.some(loaded => !loaded)) warnings.add("Some embedded fonts could not be loaded. Install the matching fonts for closer appearance.")

            const convertedSlides = pkg.getSlides()
            pkg.warnings.forEach(warning => warnings.add(warning))
            if (!convertedSlides.some(Boolean)) throw new Error("PowerPoint presentation contains no readable slides")
            let slides: { [key: string]: Slide } = {}
            let layouts: SlideData[] = []
            let firstSlideId = ""
            convertedSlides.forEach((slide) => {
                if (!slide) return

                const id = uid()

                slides[id] = {
                    group: !firstSlideId ? "." : null,
                    color: null,
                    settings: { color: slide.bgColor || "" },
                    notes: slide.notes,
                    items: slide.items
                }

                const layoutData = { transition: { type: "none", duration: 0, easing: "linear" } as const }

                if (!firstSlideId) {
                    firstSlideId = id
                    slides[id].children = []
                    layouts.push({ id, ...layoutData, children: {} })
                } else {
                    slides[firstSlideId].children!.push(id)
                    layouts[0].children![id] = layoutData
                }
            })

            // create show
            const layoutID = uid()
            const show: Show = new ShowObj(false, categoryId, layoutID, 0, false)
            show.name = checkName(name)
            show.origin = "powerpoint"
            show.settings.customFonts = fonts

            const meta: any = content["docProps/core.xml"]?.["cp:coreProperties"]
            if (meta) {
                show.meta = {
                    title: meta["dc:title"]?.[0] || show.name,
                    artist: meta["dc:creator"]?.[0] || ""
                }
                show.timestamps = {
                    created: new Date(meta["dcterms:created"]?.[0]?._ || 0).getTime(),
                    modified: new Date(meta["dcterms:modified"]?.[0]?._ || 0).getTime(),
                    used: null
                }
            }

            show.slides = slides
            show.layouts = { [layoutID]: { name: translateText("example.default"), notes: "", slides: layouts } }

            tempShows.push({ id: uid(), show })
        }

        for (const warning of await resolveImportedFonts(tempShows.map(entry => entry.show))) warnings.add(warning)
        setTempShows(tempShows)
        if (warnings.size) {
            alertMessage.set("PowerPoint imported with limitations:\n" + [...warnings].join("\n"))
            activePopup.set("alert")
        }
    }
}

function getAllFontNames(contentPaths: Record<string, string>) {
    const fontNames: { name: string; path: string; type: "local" }[] = []
    Object.keys(contentPaths).forEach((key) => {
        if (key.startsWith("ppt/fonts/") && key.endsWith(".fntdata")) {
            const fileName = key.slice(key.lastIndexOf("/") + 1)
            const match = fileName.match(/^(.+?)-?(regular|bold|italic|boldItalic)?\.fntdata$/i)
            if (match) {
                const name = spaceOnUppercase(match[1])
                fontNames.push({ name, path: contentPaths[key], type: "local" })
            }
        }
    })
    return fontNames
}

function spaceOnUppercase(str: string) {
    // should not have space if there are multiple uppercase in a row (e.g., "PT Sans" not "P T Sans")
    return str.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
}
