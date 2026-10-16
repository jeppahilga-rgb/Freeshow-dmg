import { expect, it } from "vitest"
import { importedFontNames } from "../utils/importFontNames"
it("finds requested imported fonts in items and runs without reporting fallback faces", () => {
    expect(importedFontNames({ slides: { one: { items: [{ style: "font-family: 'Rubik', Calibri;", lines: [{ text: [{ style: 'font-family: "Archivo";font-weight:700;' }] }] }, { style: "font-family: Rubik, sans-serif;" }] } } })).toEqual(["Archivo", "Rubik"])
})
it("ignores generic CSS families and deduplicates font requests", () => {
    expect(importedFontNames([{ style: "font-family: sans-serif;" }, { style: "font-family: system-ui;" }, { style: "font-family: Inter;" }, { style: "font-family: Inter;" }])).toEqual(["Inter"])
})
