import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { websiteAction, activePopup, livePrepare } from "../stores"
import { get } from "svelte/store"

export function attachNativeWebsite(target: HTMLElement, options: any) {
    const id = `${getCurrentWindow().label}-website-${crypto.randomUUID()}`
    let destroyed = false, busy = false, last = "", loadedUrl = "", lastStatus = 0, statusBusy = false
    let history = { canGoBack: false, canGoForward: false, url: "" }
    let isMuted=false
    const applyStatus = (state: any) => {
        if (!state || destroyed) return
        history = state
        options.onReady?.(controls,controls)
        if (state.url) options.onNavigate?.(state.url)
    }
    const action = async (action: string, key?: string) => applyStatus(await invoke("website_view", { id, action, key }))
    const controls = { reload: () => action("reload"), goBack: () => action("back"), goForward: () => action("forward"), canGoBack: () => history.canGoBack, canGoForward: () => history.canGoForward, getCurrentUrl: () => history.url || options.src }
    async function sync() {
        if (destroyed || busy) return
        const rect = target.getBoundingClientRect()
        const previewContext = target.closest(".editItem.selected, .outputPreview") || (rect.width >= 300 && target.closest(".main.active"))
        const visible = (!options.isOutput || !get(livePrepare)[options.outputId]) && (options.isOutput || (!get(activePopup) && !!previewContext)) && rect.width > 1 && rect.height > 1 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth && getComputedStyle(target).visibility !== "hidden"
        const bounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        // Native child views do not inherit the slide's CSS zoom.
        const ratio = Number(options.ratio) > 0 ? Number(options.ratio) : 1
        const zoom = Math.max(0.01, (Number(options.zoom) || 100) / 100 * ratio)
        const state = JSON.stringify([visible, bounds, zoom, options.src, !!options.isOutput])
        if (state === last) {
            if (visible && !statusBusy && Date.now() - lastStatus >= 750) {
                statusBusy = true; lastStatus = Date.now()
                try { await action("status") } catch (error) { console.error("Website navigation status:", error) }
                finally { statusBusy = false }
            }
            return
        }
        busy = true
        try {
            const result = await invoke("website_view", { id, action: visible ? "show" : "hide", bounds, zoom, muted: !options.isOutput||isMuted, url: visible && loadedUrl !== options.src ? options.src : null })

            if (visible) loadedUrl = options.src
            last = state
            applyStatus(result)
        } catch (error) { console.error("Native website:", error) }
        finally {
            busy = false
            if (destroyed) void invoke("website_view", { id, action: "close" }).catch(console.error)
        }
    }
    const timer = setInterval(() => void sync(), 150)
    const unsubscribePrepare = livePrepare.subscribe(() => { void sync() })
    const unsubscribePopup = activePopup.subscribe(() => { void sync() })
    const unsubscribe = websiteAction.subscribe(request => {
        if (!request||!loadedUrl||request.src&&request.src!==options.src)return
        if(request.type==="mute"){isMuted=request.muted;void invoke("website_view",{id,action:"mute",muted:!options.isOutput||isMuted}).catch(console.error)}
        else void action(request.type === "key" ? "key" : "reload", request.type === "key" ? request.keyCode : undefined).catch(console.error)
    })
    void sync()
    return {
        update(next: any) { options = next; void sync() },
        destroy() { destroyed = true; clearInterval(timer); unsubscribe(); unsubscribePrepare(); unsubscribePopup(); if (!busy) void invoke("website_view", { id, action: "close" }).catch(console.error) }
    }
}
