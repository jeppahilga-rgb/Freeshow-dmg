export function installOutputEscapeHandlers(target: Pick<Window, "addEventListener">, label: string, exit: () => Promise<unknown>) {
    const output = label.startsWith("output-")
    const dismiss = () => { void exit().catch(error => console.error("Could not dismiss output:", error)) }
    target.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key !== "Escape") return
        if (output) { event.preventDefault(); event.stopImmediatePropagation() }
        dismiss()
    }, true)
    if (output) target.addEventListener("dblclick", (event: MouseEvent) => {
        event.preventDefault(); event.stopImmediatePropagation(); dismiss()
    }, true)
}
