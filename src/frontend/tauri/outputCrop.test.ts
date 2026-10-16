import { describe, expect, it } from "vitest"
import { getOutputCropStyle } from "../components/slide/outputCrop"

describe("output crop fitting", () => {
    const slide = { width: 16, height: 9 }
    it("leaves uncropped letterboxing to the centered canvas", () => {
        expect(getOutputCropStyle(undefined, slide, { width: 800, height: 600 }, { width: 800, height: 600 })).toBe("")
        expect(getOutputCropStyle({ top: 0, right: 0, bottom: 0, left: 0 }, slide, { width: 800, height: 600 }, { width: 800, height: 600 })).toBe("")
    })
    it("scales asymmetric physical margins into a smaller CSS viewport", () => {
        const style = getOutputCropStyle({ top: 100, right: 0, bottom: 20, left: 0 }, slide, { width: 960, height: 540 }, { width: 1920, height: 1080 })
        const numbers = [...style.matchAll(/([\d.]+)px/g)].map(match => Number(match[1]))
        ;[480 * 16 / 9, 480, 50, (960 - 480 * 16 / 9) / 2, 10, (960 - 480 * 16 / 9) / 2].forEach((value, i) => expect(numbers[i]).toBeCloseTo(value))
    })
})
