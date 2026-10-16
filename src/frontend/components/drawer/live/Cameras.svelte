<script lang="ts">
    import { createEventDispatcher, onMount, onDestroy } from "svelte"
    import { type CameraData, cameraManager } from "../../../media/cameraManager"
    import { media, special } from "../../../stores"
    import { sortByName } from "../../helpers/array"
    import { getMediaStyle } from "../../helpers/media"
    import T from "../../helpers/T.svelte"
    import Center from "../../system/Center.svelte"
    import Cam from "./Cam.svelte"
    import PhoneCamera from "./PhoneCamera.svelte"
    import RtmpCamera from "./RtmpCamera.svelte"
    import MaterialButton from "../../inputs/MaterialButton.svelte"

    export let showPlayOnHover = true
    const isTauri = !!(window as any).__TAURI_INTERNALS__

    let cams: CameraData[] = []
    $: displayedCameras = sortByName([...cams.filter(camera => !camera.id.startsWith("phone-") && !camera.id.startsWith("rtmp-")), ...($special.phoneCameras || []), ...($special.rtmpCameras || [])])
    async function refresh(requestPermission = true) {
        const cameras = await cameraManager.getCamerasList(requestPermission)
        cams = sortByName(cameras)
    }
    onMount(() => { void refresh(); navigator.mediaDevices.addEventListener("devicechange", refresh) })
    onDestroy(() => navigator.mediaDevices.removeEventListener("devicechange", refresh))

    let dispatch = createEventDispatcher()
    function click(event, cam) {
        cameraManager.clearBadCamera(cam.id)
        dispatch("click", { event, cam })
    }

    // get styling
    function getStyle(id: string, _updater: any) {
        const mediaStyle = getMediaStyle($media[id], undefined)
        return `object-fit: ${mediaStyle.fit || "contain"};filter: ${mediaStyle.filter};transform: scale(${mediaStyle.flipped ? "-1" : "1"}, ${mediaStyle.flippedY ? "-1" : "1"});`
    }
</script>

{#if isTauri}
    <PhoneCamera onChanged={() => refresh(false)} />
    <RtmpCamera onChanged={refresh} />
    <div style="width:100%;padding:8px;">
        <MaterialButton on:click={() => refresh()}>Refresh cameras</MaterialButton>
        <p style="white-space:normal;font-size:0.85em;opacity:0.7;">Phone cameras preview automatically. Hover to preview local webcams. Select a camera to send it to output. Start Iriun/DroidCam on your PC and phone before selecting it.</p>
    </div>
{/if}

{#if displayedCameras.length}
    {#each displayedCameras as cam (cam.id)}
        <Cam {cam} on:click={(e) => click(e.detail, cam)} style={getStyle(cam.id, $media)} {showPlayOnHover} />
    {/each}
{:else}
    <Center faded>
        <T id="empty.general" />
    </Center>
{/if}
