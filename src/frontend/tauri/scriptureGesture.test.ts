import { expect, it } from "vitest"
import { displayScriptureGesture } from "../components/drawer/bible/scriptureGesture"
it("requires double-click even while Scripture is live", () => {
    expect(displayScriptureGesture("click")).toBe(false)
    expect(displayScriptureGesture("dblclick")).toBe(true)
})
it("does not send modified selection clicks to output", () => {
    expect(displayScriptureGesture("click", true)).toBe(false)
    expect(displayScriptureGesture("dblclick", true)).toBe(false)
})
it("accepts only an unmodified double-click", () => {
    expect(displayScriptureGesture("dblclick", false)).toBe(true)
})