import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { writable } from "svelte/store"
const { invoke }=vi.hoisted(()=>({invoke:vi.fn()}))
vi.mock("@tauri-apps/api/core",()=>({invoke}))
vi.mock("@tauri-apps/api/window",()=>({getCurrentWindow:()=>({label:"output-test"})}))
vi.mock("../stores",()=>({websiteAction:writable(null),activePopup:writable(null),livePrepare:writable({})}))
import { websiteAction, livePrepare, activePopup } from "../stores"
import { attachNativeWebsite } from "./websiteView"
let view:ReturnType<typeof attachNativeWebsite>|undefined
beforeEach(()=>{
    invoke.mockReset();websiteAction.set(null);livePrepare.set({});activePopup.set(null)
    vi.stubGlobal("innerWidth",1920);vi.stubGlobal("innerHeight",1080);vi.stubGlobal("getComputedStyle",()=>({visibility:"visible"}))
    invoke.mockResolvedValue({canGoBack:true,canGoForward:false,url:"https://example.com/second"})
})
afterEach(()=>{view?.destroy();view=undefined;vi.unstubAllGlobals()})
it("scales native page zoom with the slide preview and updates when resized",async()=>{
    const target={getBoundingClientRect:()=>({x:0,y:0,width:320,height:180,bottom:180,right:320,top:0,left:0}),closest:()=>({})} as any
    view=attachNativeWebsite(target,{isOutput:false,src:"https://example.com",ratio:1/6,zoom:100})
    await vi.waitFor(()=>expect(invoke).toHaveBeenCalledWith("website_view",expect.objectContaining({action:"show",zoom:1/6})))
    view.update({isOutput:false,src:"https://example.com",ratio:0.5,zoom:150})
    await vi.waitFor(()=>expect(invoke).toHaveBeenCalledWith("website_view",expect.objectContaining({action:"show",zoom:0.75,url:null})))
})
it("uses native navigation state and sends back/forward and keyboard actions",async()=>{
    const ready=vi.fn(),navigate=vi.fn()
    const target={getBoundingClientRect:()=>({x:0,y:0,width:640,height:360,bottom:360,right:640,top:0,left:0}),closest:()=>null} as any
    view=attachNativeWebsite(target,{isOutput:true,src:"https://example.com",onReady:ready,onNavigate:navigate})
    await vi.waitFor(()=>expect(ready).toHaveBeenCalled())
    const controls=ready.mock.calls[0][0]
    expect(controls.canGoBack()).toBe(true);expect(controls.canGoForward()).toBe(false)
    expect(navigate).toHaveBeenCalledWith("https://example.com/second")
    await controls.goBack();await controls.goForward()
    websiteAction.set({type:"key",src:"https://example.com",keyCode:"Right"})
    await vi.waitFor(()=>expect(invoke).toHaveBeenCalledWith("website_view",expect.objectContaining({action:"key",key:"Right"})))
    expect(invoke).toHaveBeenCalledWith("website_view",expect.objectContaining({action:"back"}))
    expect(invoke).toHaveBeenCalledWith("website_view",expect.objectContaining({action:"forward"}))
    const beforeMute=invoke.mock.calls.length
    websiteAction.set({type:"mute",src:"https://example.com",muted:true})
    await vi.waitFor(()=>expect(invoke).toHaveBeenCalledWith("website_view",expect.objectContaining({action:"mute",muted:true})))
    expect(invoke.mock.calls.slice(beforeMute).some(([,args])=>args.action==="reload")).toBe(false)
})

it("mutes editor websites and hides output during live preparation without reloading",async()=>{
    const target={getBoundingClientRect:()=>({x:0,y:0,width:640,height:360,bottom:360,right:640,top:0,left:0}),closest:()=>({})} as any
    view=attachNativeWebsite(target,{isOutput:false,outputId:"test",src:"https://example.com"})
    await vi.waitFor(()=>expect(invoke).toHaveBeenCalledWith("website_view",expect.objectContaining({action:"show",muted:true})))
    view.destroy();view=attachNativeWebsite(target,{isOutput:true,outputId:"test",src:"https://example.com"})
    await vi.waitFor(()=>expect(invoke).toHaveBeenCalledWith("website_view",expect.objectContaining({action:"show",muted:false})))
    livePrepare.set({test:true})
    await vi.waitFor(()=>expect(invoke).toHaveBeenCalledWith("website_view",expect.objectContaining({action:"hide"})))
    livePrepare.set({test:false})
    await vi.waitFor(()=>expect(invoke).toHaveBeenCalledWith("website_view",expect.objectContaining({action:"show",url:null})))
})
