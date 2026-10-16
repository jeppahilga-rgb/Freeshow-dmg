import { XMLParser } from "fast-xml-parser"

export function parsePowerPointPackage(raw: { xml: Record<string, string>; contentPaths: Record<string, string> }) {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", preserveOrder: true, allowBooleanAttributes: true, ignoreDeclaration: true, trimValues: false })
    const parts: Record<string, any> = { contentPaths: raw.contentPaths }
    for (const [name, xml] of Object.entries(raw.xml)) parts[name] = parser.parse(xml)
    if (!parts["ppt/presentation.xml"]) throw Error("The presentation has no readable slide list")
    return parts
}
