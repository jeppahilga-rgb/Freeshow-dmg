<script lang="ts">
    import { createEventDispatcher, onDestroy } from "svelte"

    export let id: string

    let videoElem: HTMLVideoElement | undefined
    let currentStream: MediaStream | null = null

    let constraints: any = {
        video: {
            // https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSettings/cursor
            // hiding the cursor is not yet supported
            // cursor: "never",
            mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: id,
                maxWidth: 1920,
                maxHeight: 1080,
                // maxAspectRatio: 16/9,
                maxFrameRate: 60
            }
        }
    }

    let destroyed = false, generation = 0, currentId = ""
    $: if (videoElem && id !== currentId) { currentId = id; void capture(id) }
    async function capture(sourceId: string) {
        const version = ++generation
        stopStream()
        constraints.video.mandatory.chromeMediaSourceId = sourceId
        navigator.mediaDevices
            .getUserMedia(constraints)
            .then((stream) => {
                if (destroyed || version !== generation || !videoElem) { stream.getTracks().forEach(track => track.stop()); return }
                currentStream = stream
                videoElem.onloadedmetadata = loaded
                videoElem.srcObject = stream
            })
            .catch((err) => {
                console.error(err.name + ": " + err.message)
            })
    }

    onDestroy(() => { destroyed = true; generation++; stopStream() })
    function stopStream() {
        currentStream?.getTracks().forEach(track => track.stop())
        currentStream = null
        if (videoElem) videoElem.srcObject = null
    }

    let dispatch = createEventDispatcher()
    function loaded() {
        // WIP not working!!!
        console.log("window loaded")
        if (!videoElem) return

        videoElem.play()
        dispatch("loaded", true)
    }
</script>

<video autoplay muted playsinline bind:this={videoElem} class={$$props.class} style={$$props.style}>
    <track kind="captions" />
</video>
