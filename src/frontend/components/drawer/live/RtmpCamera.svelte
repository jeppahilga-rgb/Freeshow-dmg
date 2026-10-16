<script lang="ts">
    import { invoke } from '@tauri-apps/api/core'
    import { onDestroy } from 'svelte'
    import { special } from '../../../stores'
    import MaterialButton from '../../inputs/MaterialButton.svelte'
    export let onChanged = () => {}
    let open = false, busy = false, error = '', urls: string[] = [], url = '', id = '', ready = false, copied = false
    let timer: ReturnType<typeof setInterval> | undefined
    let checking = false
    async function check() {
        if (!id || checking) return
        checking = true
        try { const state = await invoke<{ ready?: boolean }>('rtmp_input_request', { id, action: 'status', sdp: null, session: null }); const wasReady = ready; ready = !!state.ready; if (ready !== wasReady) { special.update(s => ({ ...s, rtmpCameras: ready ? [{ id, name: 'RTMP camera · DJI / encoder', group: '' }] : [] })); onChanged() } }
        catch (e) { ready = false; error = String(e) }
        finally { checking = false }
    }
    async function start() {
        busy = true; error = ''; open = true
        try {
            const input = await invoke<{ id: string; urls: string[] }>('rtmp_input_start')
            id = input.id; urls = input.urls; url = urls[0] || ''
            ready = false; special.update(s => ({ ...s, rtmpCameras: [] }))
            onChanged(); clearInterval(timer); timer = setInterval(check, 2000); await check()
        } catch (e) { error = String(e) }
        finally { busy = false }
    }
    async function stop() {
        busy = true
        try { await invoke('rtmp_input_stop'); clearInterval(timer); id = ''; ready = false; urls = []; url = ''; special.update(s => ({ ...s, rtmpCameras: [] })); onChanged() }
        catch (e) { error = String(e) }
        finally { busy = false }
    }
    async function copy() { try { await navigator.clipboard.writeText(url); copied = true; setTimeout(() => copied = false, 2000) } catch { error = 'Select and copy the address below.' } }
    onDestroy(() => clearInterval(timer))
</script>
<div class="setup">
    <MaterialButton on:click={() => id ? open = !open : start()} disabled={busy}>RTMP camera input</MaterialButton>
    {#if open}<div class="panel">
        <h3>RTMP camera · DJI Pocket 3</h3>
        {#if busy}<p>Starting local receiver…</p>{:else if id}
            <p><b>{ready ? 'Connected · select the RTMP camera card below' : 'Waiting for camera'}</b></p>
            <p>Connect the camera and PC to the same Wi-Fi. In DJI Mimo, choose Livestream → RTMP and paste this full address.</p>
            <input aria-label="RTMP destination" value={url} readonly on:focus={e => e.currentTarget.select()} />
            <MaterialButton on:click={copy}>{copied ? 'Copied' : 'Copy RTMP address'}</MaterialButton>
            <details><summary>Connection options</summary>
                <label>PC address <select bind:value={url}>{#each urls as address}<option value={address}>{new URL(address).hostname}</option>{/each}</select></label>
                <p>For encoders with separate fields: server address <b>{url ? url.slice(0, url.lastIndexOf('/')) : ''}</b>, stream key <b>{url ? url.slice(url.lastIndexOf('/') + 1) : ''}</b>.</p>
                <p>Allow FreeShow’s bundled MediaMTX receiver through Windows Firewall on your private network if prompted. H.264 video is supported; this camera input is video only.</p>
            </details>
            <MaterialButton on:click={stop} disabled={busy}>Stop RTMP input</MaterialButton>
        {/if}
        {#if error}<p role="alert">{error}</p>{/if}
    </div>{/if}
</div>
<style>.setup{width:100%;padding:8px;box-sizing:border-box}.panel{padding:16px;background:var(--primary-darkest);border-radius:8px;margin-top:8px}p{white-space:normal;line-height:1.5;font-size:.9em;overflow:visible;text-overflow:clip}input{width:100%;box-sizing:border-box;padding:8px;margin:12px 0}select{max-width:100%}</style>
