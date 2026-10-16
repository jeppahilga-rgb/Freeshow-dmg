import { describe, expect, it } from "vitest"
import { groupPosition } from "../converters/powerpoint/groupPosition"

describe("PowerPoint group coordinates", () => {
    it("subtracts the child origin and scales offsets and dimensions", () => {
        expect(groupPosition({ left: 120, top: 70, width: 30, height: 20 }, { left: 300, top: 200, width: 400, height: 300 }, { left: 100, top: 50, width: 200, height: 100 })).toEqual({ left: 340, top: 260, width: 60, height: 60 })
    })
    it("composes nested groups", () => {
        const group = groupPosition({ left: 20, top: 30, width: 40, height: 50 }, { left: 100, top: 200, width: 200, height: 200 }, { left: 0, top: 0, width: 100, height: 100 })
        expect(groupPosition({ left: 15, top: 15, width: 10, height: 10 }, group, { left: 5, top: 5, width: 40, height: 50 })).toEqual({ left: 160, top: 280, width: 20, height: 20 })
    })
})
