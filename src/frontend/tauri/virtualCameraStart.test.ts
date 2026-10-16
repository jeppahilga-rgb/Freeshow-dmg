import { beforeEach, expect, it, vi } from "vitest"
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke }))
import { startVirtualCameraOutput } from "./virtualCameraStart"
const original = { screen: "1", virtualCamera: false, alwaysOnTop: true, enabled: true }
beforeEach(() => invoke.mockReset())
it("rejects missing prerequisites before changing routing or opening an output", async () => {
    const commit = vi.fn(); invoke.mockRejectedValueOnce(Error("Install camera"))
    await expect(startVirtualCameraOutput("center", original, true, commit)).rejects.toThrow("Install camera")
    expect(invoke).toHaveBeenCalledTimes(1); expect(commit).not.toHaveBeenCalled()
})
it.each([true, false])("restores previous render state (%s) when camera start fails", async wasActive => {
    const commit = vi.fn()
    invoke.mockImplementation(async (command, args) => { if (command === "virtual_camera" && args.action === "start") throw Error("Capture failed") })
    await expect(startVirtualCameraOutput("center", original, wasActive, commit)).rejects.toThrow("Capture failed")
    expect(commit).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenLastCalledWith("output_message", { msg: { channel: "TOGGLE_OUTPUTS", data: { state: wasActive, autoPosition: false, outputs: [{ ...original, id: "center" }] } } })
    expect(original.screen).toBe("1")
})
it("commits camera-only routing only after native capture succeeds", async () => {
    const commit = vi.fn(); invoke.mockResolvedValue(undefined)
    await startVirtualCameraOutput("center", original, false, commit)
    expect(invoke.mock.calls.map(c => c[1].action || c[1].msg.channel)).toEqual(["preflight", "TOGGLE_OUTPUTS", "start"])
    expect(commit).toHaveBeenCalledWith({ ...original, virtualCamera: true, screen: null, alwaysOnTop: false })
    expect(commit.mock.invocationCallOrder[0]).toBeGreaterThan(invoke.mock.invocationCallOrder.at(-1)!)
})
it("reports rollback failure rather than silently claiming the output was restored", async () => {
    invoke.mockResolvedValueOnce({}).mockResolvedValueOnce({}).mockRejectedValueOnce(Error("Capture failed")).mockRejectedValueOnce(Error("Restore failed"))
    await expect(startVirtualCameraOutput("center", original, true, vi.fn())).rejects.toThrow("Could not restore the previous output")
})
