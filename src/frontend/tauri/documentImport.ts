import { invoke } from "@tauri-apps/api/core"
import { beginDropTransfer } from "./dropTransfer"

// Render one page at a time to avoid retaining every slide's canvas in memory.
export async function importDocument(path: string, progress: (value: number) => void = () => {}): Promise<{ images: string[]; name: string }> {
    progress(0)
    const bytes = await invoke<ArrayBuffer | number[]>("document_pdf", { path })
    const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist")
    GlobalWorkerOptions.workerSrc = "./assets/pdf.worker.min.mjs"
    const task = getDocument({ data: Array.isArray(bytes) ? Uint8Array.from(bytes) : new Uint8Array(bytes) })
    const images: string[] = []
    const canvas = document.createElement("canvas")
    let transfer: Awaited<ReturnType<typeof beginDropTransfer>> | undefined
    try {
        const pdf = await task.promise
        if (pdf.numPages > 1000) throw Error("Document exceeds 1,000 pages")
        transfer = await beginDropTransfer()
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i)
            const base = page.getViewport({ scale: 1 })
            const viewport = page.getViewport({ scale: 2160 / Math.max(base.width, base.height) })
            canvas.width = Math.ceil(viewport.width)
            canvas.height = Math.ceil(viewport.height)
            const context = canvas.getContext("2d")!
            await page.render({ canvasContext: context, canvas, viewport, background: "white" }).promise
            const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(Error("Unable to save document page")), "image/png"))
            images.push(await transfer.append(new File([blob], `page-${i}.png`, { type: "image/png" })))
            page.cleanup()
            progress(Math.round(i / pdf.numPages * 100))
        }
        await transfer.finish()
        return { images, name: path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "") }
    } catch (error) {
        await transfer?.cancel().catch(cleanup => console.error("Document import cleanup failed:", cleanup))
        throw error
    } finally {
        canvas.width = canvas.height = 0
        await task.destroy()
    }
}
