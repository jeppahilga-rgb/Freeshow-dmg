<script lang="ts">
    import { createEventDispatcher, onMount, onDestroy } from "svelte"
    import { nativeSources, nativeThumbnail, openCaptureBrowser, type CaptureSource } from "../../../tauri/nativeCapture"
    import Icon from "../../helpers/Icon.svelte"
    import MaterialButton from "../../inputs/MaterialButton.svelte"
    import { os } from "../../../stores"
    export let kind: "screen" | "window"
    export let searchValue = ""
    let sources: CaptureSource[] = []
    let previews: Record<string, string> = {}
    let unavailable: Record<string, boolean> = {}
    let error = ""
    let loading = false
    let generation = 0
    let destroyed = false
    let browserUrl = "https://www.youtube.com/", openingBrowser = false, browserNotice = ""
    async function openBrowser() {
        openingBrowser = true; browserNotice = ""
        try {
            await openCaptureBrowser(browserUrl)
            browserNotice = $os.platform === "darwin" ? "Play the video in your browser, then Refresh and select its window below. Keep it restored." : "Play the video in the new browser, then Refresh and select its window below. Keep it restored."
        } catch (err) { error = String(err) }
        finally { openingBrowser = false }
    }
    const dispatch = createEventDispatcher()
    $: filtered = sources.filter(source => source.name.toLowerCase().includes(searchValue.toLowerCase()))
    async function refresh() {
        const current = ++generation
        loading = true; error = ""
        try {
            const list = (await nativeSources()).filter(source => source.kind === kind)
            if (destroyed || current !== generation) return
            Object.values(previews).forEach(url => URL.revokeObjectURL(url))
            previews = {}; unavailable = {}; sources = list
            let next = 0
            async function worker() {
                while (!destroyed && current === generation && next < list.length) {
                    const source = list[next++]
                    try {
                        const url = await nativeThumbnail(source.id)
                        if (destroyed || current !== generation) URL.revokeObjectURL(url)
                        else previews = { ...previews, [source.id]: url }
                    } catch { if (!destroyed && current === generation) unavailable = { ...unavailable, [source.id]: true } }
                }
            }
            await Promise.all([worker(), worker()])
        } catch (err: any) { if (!destroyed && current === generation) error = String(err) }
        finally { if (!destroyed && current === generation) loading = false }
    }
    onMount(refresh)
    onDestroy(() => { destroyed = true; generation++; Object.values(previews).forEach(url => URL.revokeObjectURL(url)) })
</script>

<div class="sources" data-native-sources={kind}>
    <div class="toolbar">
        <span>{kind === "screen" ? "Screens" : "Windows"} · Mouse pointer hidden</span>
        <MaterialButton disabled={loading} on:click={refresh}>{loading ? "Loading previews…" : "Refresh"}</MaterialButton>
    </div>
    {#if error}<p class="error">{error}</p>{/if}
    {#if kind === "window"}
        <div class="capture-browser">
            <p>{$os.platform === "darwin" ? "Open a website in your default browser, then select its window for capture." : "Video stops when covered? Open a capture browser that keeps rendering behind FreeShow."}</p>
            <div class="browser-row">
                <input type="url" aria-label="Capture website address" bind:value={browserUrl} placeholder="https://www.youtube.com/" />
                <MaterialButton disabled={openingBrowser || !browserUrl.trim()} on:click={openBrowser}>{openingBrowser ? "Opening…" : "Open capture browser"}</MaterialButton>
            </div>
            <small>{$os.platform === "darwin" ? "Uses your existing browser profile. Screen capture is video only; protected content or a minimized window may be unavailable." : "Uses a separate browser profile. You may need to sign in again. Close the browser when finished."}</small>
            {#if browserNotice}<p role="status">{browserNotice}</p>{/if}
        </div>
    {/if}
    <div class="grid">
        {#each filtered as source (source.id)}
            <button class="source" title={source.name} data-source-id={source.id} on:click={event => dispatch("click", { event, screen: source })}>
                <div class="preview">
                    {#if previews[source.id]}<img src={previews[source.id]} alt="" />
                    {:else}<Icon id={kind === "screen" ? "screen" : "window"} white /><small>{unavailable[source.id] ? "Preview unavailable" : "Loading…"}</small>{/if}
                </div>
                <div class="name"><Icon id={kind === "screen" ? "screen" : "window"} white /><span>{source.name}</span></div>
            </button>
        {/each}
    </div>
    {#if !loading && !sources.length && !error}<p class="empty">No available {kind === "screen" ? "screens" : "windows"}. Restore a window, then refresh.</p>{/if}
</div>

<style>
    .sources { width:100%; min-width:0; }
    .toolbar { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 8px; color:var(--secondary-text); font-size:12px; }
    .toolbar :global(button) { padding:4px 8px !important; font-size:12px; }
    .grid { display:flex; flex-wrap:wrap; justify-content:center; gap:6px; padding:4px 8px 10px; }
    .source { padding:0; width:134px; border:2px solid transparent; border-radius:4px; overflow:hidden; background:var(--primary-darker); color:var(--primary-text); cursor:pointer; }
    .source:hover, .source:focus-visible { border-color:var(--secondary); outline:none; }
    .preview { aspect-ratio:16/9; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; background:#101117; }
    .preview img { width:100%; height:100%; object-fit:contain; }
    .preview small { font-size:10px; opacity:.65; }
    .name { display:flex; align-items:center; gap:6px; padding:4px 6px; font-size:12px; }
    .name span { white-space:nowrap; text-overflow:ellipsis; overflow:hidden; }
    .error, .empty { padding:8px; overflow-wrap:anywhere; }
    .error { color:#ff9a9a; }
    .capture-browser { padding:8px; background:var(--primary-darker); border-radius:4px; margin:4px 8px 8px; font-size:12px; }
    .capture-browser p { margin:0 0 8px; }
    .capture-browser small { display:block; margin-top:6px; color:var(--secondary-text); }
    .browser-row { display:flex; flex-wrap:wrap; gap:6px; }
    .browser-row input { flex:1; min-width:160px; background:var(--primary-darkest); color:var(--primary-text); border:1px solid var(--primary-light); border-radius:4px; padding:6px 8px; }
    .browser-row :global(button) { padding:6px 8px !important; }
</style>
