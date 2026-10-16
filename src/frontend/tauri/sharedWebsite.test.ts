import { it, expect, vi, afterEach } from "vitest"
import { writable } from "svelte/store"
const {invoke}=vi.hoisted(()=>({invoke:vi.fn()}))
vi.mock("@tauri-apps/api/core",()=>({invoke}))
vi.mock("@tauri-apps/api/window",()=>({getCurrentWindow:()=>({label:"main"})}))
vi.mock("../stores",()=>({activePopup:writable(null),livePrepare:writable({}),websiteAction:writable(null)}))
import {attachSharedWebsite} from "./sharedWebsite"
import {websiteAction} from "../stores"
let views:ReturnType<typeof attachSharedWebsite>[]=[]
afterEach(()=>{views.forEach(view=>view.destroy());views=[];vi.unstubAllGlobals();invoke.mockReset()})
it("renders full-resolution shared frames and forwards preview clicks to the same source",async()=>{
    const draw=vi.fn(),close=vi.fn()
    const nodes:any[]=[]
    vi.stubGlobal("window",{addEventListener:vi.fn(),removeEventListener:vi.fn()})
    vi.stubGlobal("document",{createElement:()=>{const node={style:{},getContext:()=>({drawImage:draw}),remove:vi.fn(),focus:vi.fn(),getBoundingClientRect:()=>({left:0,top:0,width:320,height:180})};nodes.push(node);return node}})
    vi.stubGlobal("getComputedStyle",()=>({visibility:"visible"}));vi.stubGlobal("innerWidth",1920);vi.stubGlobal("innerHeight",1080)
    vi.stubGlobal("createImageBitmap",vi.fn(async()=>({width:1920,height:1080,close})))
    invoke.mockImplementation(async(name)=>name==="shared_website_frame"?new Uint8Array([1,2]).buffer:{url:"https://example.com"})
    const target={append:vi.fn(),closest:()=>({}),getBoundingClientRect:()=>({width:320,height:180,bottom:180,right:320,left:0,top:0})} as any
    views.push(attachSharedWebsite(target,{src:"https://example.com",ratio:1/6,isOutput:false}))
    views.push(attachSharedWebsite(target,{src:"https://example.com",ratio:1/6,isOutput:false}))
    await vi.waitFor(()=>expect(draw.mock.calls.length).toBeGreaterThanOrEqual(2))
    expect(invoke).toHaveBeenCalledWith("shared_website",expect.objectContaining({url:"https://example.com",action:"show",data:{width:1920,height:1080,zoom:1}}))
    expect(close.mock.calls.length).toBeLessThan(draw.mock.calls.length)
    expect(nodes[0].style.cssText).toContain("pointer-events:auto")
    nodes[2].onclick({preventDefault:vi.fn(),stopPropagation:vi.fn()})
    await vi.waitFor(()=>expect(invoke).toHaveBeenCalledWith("shared_website",expect.objectContaining({action:"control",data:null})))
    expect(nodes[0].width).toBe(320)
    // An offscreen/unselected thumbnail has no polling registration, but can
    // still be clicked to explicitly open its source.
    views.push(attachSharedWebsite({...target,closest:()=>null},{src:"https://unselected.example",ratio:1/6,isOutput:false}))
    const before=invoke.mock.calls.length
    nodes[8].onclick({preventDefault:vi.fn(),stopPropagation:vi.fn()})
    await vi.waitFor(()=>expect(invoke).toHaveBeenCalledWith("shared_website",expect.objectContaining({url:"https://unselected.example",action:"control"})))
    const actions=invoke.mock.calls.slice(before).filter(([name,args])=>name==="shared_website"&&args.url==="https://unselected.example").map(([,args])=>args.action)
    expect(actions).toEqual(["show","control"])
    // Main-window output mirrors are still outputs, despite isOutput=false.
    views.push(attachSharedWebsite({...target,closest:()=>null},{src:"https://output.example",isOutput:false}))
    expect(nodes[11].style.display).toBe("none")
    expect(nodes[2].style.display).toBe("block")
    views.push(attachSharedWebsite(target,{src:"https://live.example",ratio:1/6,isOutput:true,outputId:"center"}))
    await vi.waitFor(()=>expect(invoke).toHaveBeenCalledWith("shared_website",expect.objectContaining({url:"https://live.example",action:"input",data:{type:"play"}})))
    expect(invoke.mock.calls.filter(([name,args])=>name==="shared_website"&&args.url==="https://example.com"&&args.data?.type==="play")).toHaveLength(0)
    const beforeMute=invoke.mock.calls.length
    websiteAction.set({src:"https://live.example",type:"mute",muted:true})
    await vi.waitFor(()=>expect(invoke).toHaveBeenCalledWith("shared_website",expect.objectContaining({url:"https://live.example",action:"mute",data:{muted:true}})))
    expect(invoke.mock.calls.slice(beforeMute).some(([,args])=>args.url==="https://live.example"&&args.data?.type==="reload")).toBe(false)
    websiteAction.set(null)
})
