import { describe, expect, it } from "vitest"
import { scriptureOutputTargets } from "../components/drawer/bible/scriptureOutputs"
const outputs = [{ id: "center", enabled: true }, { id: "side", enabled: true }, { id: "disabled", enabled: false }, { id: "stage", enabled: true, stageOutput: true }]
describe("Scripture output selection", () => {
    it("keeps active-output routing unless a Scripture selection is saved", () => {
        expect(scriptureOutputTargets({}, outputs)).toBeUndefined()
    })
    it("selects only the requested enabled presentation outputs", () => {
        expect(scriptureOutputTargets({ outputIds: ["side", "disabled", "stage", "removed"] }, outputs)).toEqual(["side"])
    })
    it("does not broadcast when a saved selection has no available target", () => {
        expect(scriptureOutputTargets({ outputIds: [] }, outputs)).toEqual([])
        expect(scriptureOutputTargets({ outputIds: ["removed"] }, outputs)).toEqual([])
    })
    it("supports both screens without duplicates", () => {
        expect(scriptureOutputTargets({ outputIds: ["center", "side", "center"] }, outputs)).toEqual(["center", "side"])
    })
})
