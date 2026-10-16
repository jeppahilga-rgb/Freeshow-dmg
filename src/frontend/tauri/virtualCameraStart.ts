import { invoke } from "@tauri-apps/api/core"

export async function startVirtualCameraOutput(outputId: string, original: any, wasActive: boolean, commit: (value: any) => void) {
    await invoke("virtual_camera", { action: "preflight", output: outputId })
    const camera = { ...original, virtualCamera: true, screen: null, alwaysOnTop: false }
    try {
        await invoke("output_message", { msg: { channel: "TOGGLE_OUTPUTS", data: { state: true, autoPosition: true, outputs: [{ ...camera, id: outputId }] } } })
        await invoke("virtual_camera", { action: "start", output: outputId })
    } catch (error) {
        try {
            await invoke("output_message", { msg: { channel: "TOGGLE_OUTPUTS", data: { state: wasActive, autoPosition: false, outputs: [{ ...original, id: outputId }] } } })
        } catch (rollback) { throw Error(`${String(error)}. Could not restore the previous output: ${String(rollback)}`) }
        throw error
    }
    // Persist routing only after both native operations have succeeded.
    commit(camera)
}
