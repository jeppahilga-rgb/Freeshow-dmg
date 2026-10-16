import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { get } from "svelte/store"
import { activePopup, livePrepare, websiteAction } from "../stores"
import { createWebsiteFramePool } from "./websiteFrames"
const frames=createWebsiteFramePool()

export function attachSharedWebsite(target:HTMLElement, initial:any) {
    let options=initial, destroyed=false, registered=false, visible=false, timer:any, failures=0, lastZoom=0
    let lastBitmap:ImageBitmap|undefined
    let history={url:initial.src,canGoBack:false,canGoForward:false},lastStatus=0
    const id=`${getCurrentWindow().label}-website-${crypto.randomUUID()}`
    const canvas=document.createElement("canvas"), context=canvas.getContext("2d")!
    // Website.svelte disables pointer events on preview containers. Override that
    // on this canvas so its control action runs before the slide preview handler.
    canvas.style.cssText="width:100%;height:100%;display:block;outline:none;pointer-events:auto";canvas.tabIndex=0
    const error=document.createElement("div");error.style.cssText="position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:#171821;color:white;font:14px sans-serif;text-align:center"
    const controlButton=document.createElement("button")
    controlButton.textContent="Website controls"
    controlButton.title="Open the shared website in a small control window"
    controlButton.style.cssText=`position:absolute;right:6px;top:6px;z-index:5;pointer-events:auto;font:12px sans-serif;padding:5px 8px;background:#242832;color:white;border:1px solid #777;border-radius:4px;zoom:${1/(Number(options.ratio)||1)}`
    const updateControlVisibility=()=>{controlButton.style.display=!options.isOutput&&getCurrentWindow().label==="main"&&target.closest(".slide.context,.editItem")?"block":"none"}
    updateControlVisibility()
    target.append(canvas,error,controlButton)
    const command=(action:string,data?:any)=>invoke<any>("shared_website",{id,url:options.src,action,data:data??null})
    const input=(data:any)=>command("input",data).catch(e=>console.error("Website input:",e))
    const controls={reload:()=>input({type:"reload"}),goBack:()=>input({type:"back"}),goForward:()=>input({type:"forward"}),canGoBack:()=>history.canGoBack,canGoForward:()=>history.canGoForward,getCurrentUrl:()=>history.url||options.src}
    const updateStatus=(result:any)=>{if(!result)return;history={...history,...result};options.onReady?.(controls,controls);options.onNavigate?.(history.url)}
    canvas.title="Click to select the slide. Use Website controls to interact with the site."
    async function openControls() {
        try {
            // An unselected slide may not have registered a frame consumer yet.
            const r=target.getBoundingClientRect(), ratio=Number(options.ratio)>0?Number(options.ratio):1
            if(!registered) {
                await command("show",{width:r.width/ratio,height:r.height/ratio,zoom:(Number(options.zoom)||100)/100})
                registered=true
            }
            await command("control")
            error.style.display="none"
        } catch(e) {
            error.textContent=`Could not open website controls: ${String(e)}. Click to retry.`
            error.style.display="flex";error.style.pointerEvents="auto"
        }
    }
    // Let slide clicks reach FreeShow's selection/output handler.
    canvas.onclick=()=>{}
    controlButton.onclick=event=>{event.preventDefault();event.stopPropagation();void openControls()}
    error.onclick=event=>{event.stopPropagation();if(!options.isOutput)void openControls()}
    canvas.onpointerdown=()=>{}
    canvas.onwheel=event=>{event.preventDefault();event.stopPropagation();void input({type:"wheel",x:event.deltaX,y:event.deltaY})}
    canvas.onkeydown=event=>{event.preventDefault();event.stopPropagation();void input({type:"key",key:event.key})}
    const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"&&document.activeElement===canvas){event.preventDefault();event.stopImmediatePropagation();void input({type:"key",key:"Escape"})}}
    window.addEventListener("keydown",escape,true)
    const unsubscribe=websiteAction.subscribe(request=>{
        if(!registered||!request||request.src&&request.src!==options.src)return
        if(request.type==="mute")void command("mute",{muted:request.muted}).catch(e=>console.error("Website mute:",e))
        else void input(request.type==="key"?{type:"key",key:({Space:" ",Left:"ArrowLeft",Right:"ArrowRight",Up:"ArrowUp",Down:"ArrowDown"} as Record<string,string>)[request.keyCode]||request.keyCode}:{type:"reload"})
    })
    async function poll() {
        if(destroyed)return
        const started=performance.now()
        const src=options.src
        updateControlVisibility()
        const r=target.getBoundingClientRect()
        const preview=target.closest(".editItem.selected,.previewOutput,.outputPreview") || (r.width>=300&&target.closest(".main.active"))
        const next=!!((options.isOutput?!get(livePrepare)[options.outputId]:!get(activePopup)&&preview)&&r.width>1&&r.height>1&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth&&getComputedStyle(target).visibility!=="hidden")
        try {
            const zoom=(Number(options.zoom)||100)/100
            if(next&&(!visible||zoom!==lastZoom)) {
                const becomingVisible=!visible
                const ratio=Number(options.ratio)>0?Number(options.ratio):1
                const result=await command("show",{width:r.width/ratio,height:r.height/ratio,zoom})
                if(destroyed||options.src!==src){void invoke("shared_website",{id,url:src,action:"close",data:null}).catch(()=>{});return}
                registered=true;visible=true;lastZoom=zoom;updateStatus(result)
                if(options.isOutput&&becomingVisible) await input({type:"play"})
            } else if(!next&&visible) {frames.release(options.src,id);await command("hide");visible=false}
            if(next&&!destroyed) {
                if(performance.now()-lastStatus>=750){lastStatus=performance.now();updateStatus(await command("status"))}
                await frames.draw(src,id,()=>invoke<ArrayBuffer>("shared_website_frame",{id,url:src}),bitmap=>{
                    if(!destroyed&&options.src===src){
                        // Small previews do not need full-resolution GPU textures.
                        const scale=options.isOutput||r.width>=800?1:Math.min(1,Math.max(320,r.width*(globalThis.devicePixelRatio||1))/bitmap.width)
                        const width=Math.round(bitmap.width*scale),height=Math.round(bitmap.height*scale)
                        if(lastBitmap===bitmap&&canvas.width===width&&canvas.height===height)return
                        if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height}
                        lastBitmap=bitmap
                        context.drawImage(bitmap,0,0,width,height);error.style.display="none";failures=0
                    }
                })
            }
        } catch(e) {if(++failures>=3){error.textContent=`Website source unavailable: ${String(e)}`;error.style.display="flex"}}
        finally {
            if(destroyed)void command("close").catch(()=>{})
            // Include capture/decode time in the frame budget rather than
            // adding a complete idle interval after every expensive frame.
            else timer=setTimeout(poll,!next?250:failures?500:Math.max(1,(options.isOutput||r.width>=800?33:100)-(performance.now()-started)))
        }
    }
    void poll()
    return {update(next:any){if(next.src!==options.src){frames.release(options.src,id);void command("close").catch(()=>{});registered=false;visible=false}options=next;updateControlVisibility();controlButton.style.zoom=String(1/(Number(options.ratio)||1))},destroy(){destroyed=true;frames.release(options.src,id);clearTimeout(timer);unsubscribe();window.removeEventListener("keydown",escape,true);canvas.remove();error.remove();controlButton.remove();void command("close").catch(()=>{})}}
}
