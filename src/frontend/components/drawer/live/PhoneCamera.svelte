<script lang="ts">
    import { invoke } from "@tauri-apps/api/core"
    import qrcode from "qrcode-generator"
    import { special } from "../../../stores"
    import MaterialButton from "../../inputs/MaterialButton.svelte"
    export let onChanged = () => {}
    let open = false, busy = false, error = "", urls: string[] = [], url = "", cameraId = "", qr = "", copied = false
    $: if (url) { const code = qrcode(0, "M"); code.addData(url); code.make(); qr = code.createSvgTag({ cellSize: 5, margin: 16, scalable: true }) }
    async function connect(id: string | null = null) {
        busy = true; error = ""; open = true
        try {
            const camera = await invoke<{ id: string; urls: string[] }>("phone_camera_start", { id })
            cameraId = camera.id; urls = camera.urls; url = urls.find(u => !u.includes("127.0.0.1")) || urls[0]
            if (!($special.phoneCameras || []).some(c => c.id === camera.id)) {
                special.update(s => ({ ...s, phoneCameras: [...(s.phoneCameras || []), { id: camera.id, name: `Phone camera ${(s.phoneCameras || []).length + 1}`, group: "" }] }))
                onChanged()
            }
        } catch (e) { error = String(e) }
        finally { busy = false }
    }
    async function copy() { try { await navigator.clipboard.writeText(url); copied = true; setTimeout(() => copied = false, 2000) } catch { error = "Could not copy. Select and copy the link below." } }
</script>
<div class="phone-setup">
    <MaterialButton on:click={() => open ? open = false : connect(($special.phoneCameras || [])[0]?.id || null)} disabled={busy}>Connect phone camera</MaterialButton>
    {#if open}
        <div class="panel">
            <h3>Phone camera · Offline</h3>
            <p>Connect your phone and PC to the same Wi-Fi or phone hotspot, then scan this QR code.</p>
            {#if busy}<p>Starting local connection…</p>{:else if qr}
                <div class="qr">{@html qr}</div>
                {#if ($special.phoneCameras || []).length > 1}
                    <label>Phone <select value={cameraId} on:change={e => connect(e.currentTarget.value)}>{#each $special.phoneCameras || [] as camera}<option value={camera.id}>{camera.name}</option>{/each}</select></label>
                {/if}
                <p>PC address selected automatically. Scan the QR code to connect.</p>
                <details><summary>Connection options</summary>
                    <label>PC address <select bind:value={url}>{#each urls as address}<option value={address}>{new URL(address).hostname}</option>{/each}</select></label>
                </details>
                <input aria-label="Phone camera link" value={url} readonly on:focus={e => e.currentTarget.select()} />
                <MaterialButton on:click={copy}>{copied ? "Copied" : "Copy phone link"}</MaterialButton>
                <MaterialButton on:click={() => connect()}>Add another phone</MaterialButton>
                <p>On the phone, continue through the local certificate prompt, allow camera access, and tap <b>Start camera</b>. Then select the phone camera below.</p>
                <p>If the phone cannot open the link, choose your Wi-Fi address above and allow FreeShow through Windows Firewall on your private network. Some phone browsers require trusting the local certificate before camera access.</p>
            {/if}
            {#if error}<p role="alert">{error}</p>{/if}
        </div>
    {/if}
</div>
<style>
    .phone-setup { width: 100%; padding: 8px; box-sizing: border-box; }
    .panel { padding: 16px; background: var(--primary-darkest); border-radius: 8px; margin-top: 8px; }
    p { font-size: 0.9em; line-height: 1.5; white-space: normal; overflow: visible; text-overflow: clip; }
    .qr { width: 220px; max-width: 100%; background: white; margin: 12px 0; }
    .qr :global(svg) { display: block; width: 100%; height: auto; }
    input { width: 100%; box-sizing: border-box; padding: 8px; margin: 12px 0; }
    label { display: block; margin: 8px 0; }
    select { max-width: 100%; padding: 5px; }
</style>
