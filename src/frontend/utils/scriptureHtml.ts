import createDOMPurify from "dompurify"

let purifier: ReturnType<typeof createDOMPurify> | undefined
export function sanitizeScriptureHtml(value: string): string {
    if (!purifier) {
        purifier = createDOMPurify(window)
        purifier.addHook("uponSanitizeAttribute", (_node, attribute) => {
            if (attribute.attrName !== "class") return
            attribute.attrValue = attribute.attrValue.split(/\s+/).filter(name => name === "wj" || name === "undertitle").join(" ")
            if (!attribute.attrValue) attribute.keepAttr = false
        })
    }
    return purifier.sanitize(value, {
        ALLOWED_TAGS: ["span", "b", "strong", "i", "em", "u", "s", "sup", "sub", "br"],
        ALLOWED_ATTR: ["class"], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
        FORBID_CONTENTS: ["script", "style", "iframe", "object", "template", "svg", "math"],
    })
}
