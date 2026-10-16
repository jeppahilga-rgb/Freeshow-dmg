<script lang="ts">
    import { onMount } from "svelte"
    import { invoke } from "@tauri-apps/api/core"
    import { outputs, outputState } from "../../../stores"
    import { startVirtualCameraOutput } from "../../../tauri/virtualCameraStart"
    export let outputId = ""
    export let enabled = false
    let running = false, activeOutput = "", busy = false, error = ""
    async function refresh() {
        try { const status:any = await invoke("virtual_camera", { action: "status", output: null }); running=status.running;activeOutput=status.output||"" }
        catch(e) { error=String(e) }
    }
    onMount(()=>{void refresh();const timer=setInterval(()=>{if(!busy)void refresh()},2000);return()=>clearInterval(timer)})
    async function toggle() {
        busy=true;error=""
        try {
            if (!running) {
                const output = $outputs[outputId]
                if (!output) throw new Error("Select a valid FreeShow output.")
                const wasActive = !!$outputState.find(state => state.id === outputId)?.active
                await startVirtualCameraOutput(outputId, output, wasActive, () => outputs.update(values => ({ ...values, [outputId]: { ...values[outputId], virtualCamera: true, screen: null, alwaysOnTop: false } })))
            } else await invoke("virtual_camera", { action: "stop", output: outputId })
            await refresh()
        }
        catch(e) { error=String(e) }
        finally { busy=false }
    }
</script>
<section aria-label="Virtual camera output">
    <h3>Virtual camera</h3>
    <p>Send this output to <strong>FreeShow Virtual Camera</strong> for OBS, Zoom, or another camera app.</p>
    <p>1280 × 720 · 30 fps · Video only</p>
    <button disabled={busy||(!running&&(!enabled||!outputId))} on:click={toggle}>{busy?"Please wait…":running?"Stop virtual camera":"Start virtual camera"}</button>
    {#if running}<p role="status">Running{activeOutput!==outputId?" from another output":""}.</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <p class="hint">Start renders this output outside your displays. No output screen is required. In the receiving app, select “FreeShow Virtual Camera”.</p>
</section>
<style>
    section{padding:12px 0;border-top:1px solid #454550}h3{margin:0 0 8px}p{font-size:0.85em;margin:6px 0}button{background:#252632;color:white;border:1px solid #72727d;border-radius:4px;padding:8px 16px;cursor:pointer}button:disabled{opacity:0.5;cursor:default}.error{color:#ff9999}.hint{opacity:0.7}
</style>
