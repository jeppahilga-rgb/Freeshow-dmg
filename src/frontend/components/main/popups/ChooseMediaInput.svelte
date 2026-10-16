<script lang="ts">
    import { onDestroy } from "svelte"
    import { backendService } from "../../../tauri/backendServices"
    import { activePopup, popupData } from "../../../stores"
    import BMDStreams from "../../drawer/live/BMDStreams.svelte"
    import Cameras from "../../drawer/live/Cameras.svelte"
    import NDIStreams from "../../drawer/live/NDIStreams.svelte"
    import OMTStreams from "../../drawer/live/OMTStreams.svelte"
    import Screens from "../../drawer/live/Screens.svelte"
    import Windows from "../../drawer/live/Windows.svelte"
    import Icon from "../../helpers/Icon.svelte"
    import T from "../../helpers/T.svelte"
    import MaterialButton from "../../inputs/MaterialButton.svelte"

    const isTauri = !!(window as any).__TAURI_INTERNALS__
    let activeType = "cameras"
    const channels = { ndi: "NDI", omt: "OMT", blackmagic: "BLACKMAGIC" }
    let checks: Record<string, { state: string; error?: string }> = {}
    let destroyed = false
    onDestroy(() => { destroyed = true })
    $: if (isTauri && channels[activeType] && !checks[activeType]) void checkEngine(activeType)
    async function checkEngine(type: string) {
        checks = { ...checks, [type]: { state: "checking" } }
        let timer: ReturnType<typeof setTimeout>
        try {
            await Promise.race([
                backendService("MEDIA_CHANNEL", { channel: channels[type], message: { channel: type === "blackmagic" ? "GET_DEVICES" : "RECEIVE_LIST", data: {} } }),
                new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Source discovery timed out. Check the runtime, drivers and network, then retry.")), 10000) })
            ])
            if (!destroyed) checks = { ...checks, [type]: { state: "ready" } }
        } catch (error) { if (!destroyed) checks = { ...checks, [type]: { state: "failed", error: String(error) } } }
        finally { clearTimeout(timer!) }
    }

    $: initialDevice = $popupData.active || $popupData.value
    $: if (initialDevice?.type) {
        if (initialDevice.type === "camera") activeType = "cameras"
        else if (initialDevice.type === "screen") activeType = "screens"
        else activeType = initialDevice.type
    }

    let streams: MediaStream[] = []

    function selectDevice(device: { id: string; name: string; type: string; group?: string }) {
        if ($popupData.trigger) $popupData.trigger(device)
        else popupData.set({ ...$popupData, value: device })

        activePopup.set(null)
    }

    function selectCamera({ detail }) {
        let camera = detail.cam
        selectDevice({ id: camera.id, name: camera.name, group: camera.group, type: "camera" })
    }

    function selectStream({ detail }, type: string) {
        let screen = detail.screen
        selectDevice({ id: screen.id, name: screen.name, type })
    }
</script>

<div class="choose-input-wrapper">
    <div class="tabs">
        <MaterialButton style="flex: 1;" isActive={activeType === "cameras"} on:click={() => (activeType = "cameras")}>
            <Icon size={1.2} id="camera" white />
            <p><T id="live.cameras" /></p>
        </MaterialButton>
        <MaterialButton style="flex: 1;" isActive={activeType === "screens"} on:click={() => (activeType = "screens")}>
            <Icon size={1.2} id="screen" white />
            <p><T id="live.screens" /></p>
        </MaterialButton>
        <MaterialButton style="flex: 1;" isActive={activeType === "ndi"} on:click={() => (activeType = "ndi")}>
            <Icon size={1.1} id="ndi" white />
            <p>NDI</p>
        </MaterialButton>
        <MaterialButton style="flex: 1;" isActive={activeType === "omt"} on:click={() => (activeType = "omt")}>
            <Icon size={1.2} id="omt" white />
            <p>OMT</p>
        </MaterialButton>
        <MaterialButton style="flex: 1;" isActive={activeType === "blackmagic"} on:click={() => (activeType = "blackmagic")}>
            <Icon size={1.2} id="blackmagic" white />
            <p>Blackmagic</p>
        </MaterialButton>
    </div>

    {#if isTauri && channels[activeType]}<p class="availability">{activeType === "blackmagic" ? "Connect a supported device and install its Blackmagic driver." : "Start a source on the same network. Its runtime must be installed and allowed through the firewall."}</p>{/if}
    <div class="devices">
        {#if isTauri && channels[activeType] && checks[activeType]?.state !== "ready"}
            {#if checks[activeType]?.state === "failed"}
                <div role="alert"><p>{checks[activeType].error}</p><MaterialButton on:click={() => checkEngine(activeType)}>Retry discovery</MaterialButton></div>
            {:else}<p role="status">Checking available sources…</p>{/if}
        {:else if activeType === "cameras"}
            <Cameras on:click={selectCamera} showPlayOnHover={false} />
        {:else if activeType === "screens"}
            <Screens bind:streams on:click={(e) => selectStream(e, "screen")} />
            <div style="width: 100%;height: 10px;" />
            <Windows bind:streams on:click={(e) => selectStream(e, "screen")} />
        {:else if activeType === "ndi"}
            <NDIStreams on:click={(e) => selectStream(e, "ndi")} />
        {:else if activeType === "omt"}
            <OMTStreams on:click={(e) => selectStream(e, "omt")} />
        {:else if activeType === "blackmagic"}
            <BMDStreams on:click={(e) => selectStream(e, "blackmagic")} />
        {/if}
    </div>
</div>

<style>
    .choose-input-wrapper {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .tabs {
        display: flex;
        background-color: var(--primary-darker);
        border-radius: 4px;
        overflow: hidden;
    }

    .tabs :global(button) {
        border-radius: 0;
        padding: 6px 12px;
        gap: 6px;
    }

    .tabs p {
        margin: 0;
        font-size: 0.9em;
    }

    .devices {
        display: flex;
        justify-content: center;
        flex-wrap: wrap;
        padding: 10px;
        gap: 5px;
        max-height: 60vh;
        overflow-y: auto;

        background-color: var(--primary-darker);
        border-radius: 8px;
    }

    .devices :global(.main) {
        background-color: var(--primary-darkest);
        border-radius: 4px;

        overflow: hidden;
    }
</style>
