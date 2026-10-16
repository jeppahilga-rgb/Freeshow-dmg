export function importedFontNames(value: unknown): string[] {
    const names = new Set<string>()
    function visit(node: any) {
        if (!node || typeof node !== "object") return
        if (typeof node.style === "string") for (const match of node.style.matchAll(/font-family\s*:\s*([^;]+)/gi)) {
            // Check the requested face, not each fallback in its CSS stack.
            const name = match[1].split(",")[0].trim().replace(/^['"]|['"]$/g, "")
            if (name && name.length <= 120 && !/^(sans-serif|serif|monospace|fantasy|cursive|system-ui|inherit)$/i.test(name)) names.add(name)
        }
        for (const item of Object.values(node)) if (item && typeof item === "object") visit(item)
    }
    visit(value)
    return [...names].sort()
}
