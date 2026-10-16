import { File } from "node:buffer"
import { beforeEach, expect, it, vi } from "vitest"
const { invoke, getDocument, destroy, renderPage, cleanup } = vi.hoisted(() => ({ invoke:vi.fn(),getDocument:vi.fn(),destroy:vi.fn(),renderPage:vi.fn(),cleanup:vi.fn() }))
vi.mock("@tauri-apps/api/core",()=>({invoke}))
vi.mock("pdfjs-dist",()=>({getDocument,GlobalWorkerOptions:{}}))
import { importDocument } from "./documentImport"
beforeEach(()=>{
    vi.resetAllMocks();vi.stubGlobal("File",File)
    vi.stubGlobal("document",{createElement:()=>({width:0,height:0,getContext:()=>({}),toBlob:(fn:any)=>fn(new Blob(["page"]))})})
    invoke.mockImplementation(async(command,{request})=>command==="document_pdf"?new Uint8Array([37,80,68,70]).buffer:request.action==="start"?{token:"doc",path:"C:/Imports/doc"}:null)
    getDocument.mockReturnValue({promise:Promise.resolve({numPages:2,getPage:async()=>({getViewport:()=>({width:1920,height:1080}),render:()=>({promise:renderPage()}),cleanup})}),destroy})
    renderPage.mockResolvedValue(undefined)
})
it("commits every PDF page in one transaction with binary input",async()=>{
    const result=await importDocument("C:/Deck.pdf")
    expect(result.images).toEqual(["C:/Imports/doc/page-1.png","C:/Imports/doc/page-2.png"])
    expect(getDocument.mock.calls[0][0].data).toBeInstanceOf(Uint8Array)
    const actions=invoke.mock.calls.filter(([c])=>c==="dropped_files").map(([,args])=>args.request.action)
    expect(actions).toEqual(["start","append","append","finish"])
    expect(destroy).toHaveBeenCalledOnce()
})
it("cancels already-rendered pages if a later page fails",async()=>{
    renderPage.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error("Broken second page"))
    await expect(importDocument("C:/Deck.pdf")).rejects.toThrow("Broken second page")
    const actions=invoke.mock.calls.filter(([c])=>c==="dropped_files").map(([,args])=>args.request.action)
    expect(actions).toEqual(["start","append","cancel"])
    expect(destroy).toHaveBeenCalledOnce()
})
