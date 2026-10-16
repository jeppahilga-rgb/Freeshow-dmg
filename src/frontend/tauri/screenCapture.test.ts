import { afterEach, expect, it, vi } from "vitest"
const { signal, emit, closed }=vi.hoisted(()=>({signal:{fn:null as any},emit:vi.fn(async()=>{}),closed:[] as any[]}))
vi.mock("@tauri-apps/api/event",()=>({emit,listen:vi.fn(async(_event,fn)=>{signal.fn=fn;return ()=>{}})}))
vi.mock("@tauri-apps/api/window",()=>({getCurrentWindow:()=>({label:"output-test"})}))
vi.mock("./nativeCapture",()=>({nativeCaptureStream:vi.fn()}))
import { installScreenCapture, remoteCameraStream } from "./screenCapture"
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()})
it("releases timeout callbacks and keeps a later camera attempt independent",async()=>{
    vi.useFakeTimers();emit.mockClear();closed.length=0
    vi.stubGlobal("window",{addEventListener:vi.fn()})
    vi.stubGlobal("navigator",{mediaDevices:{getUserMedia:vi.fn()}})
    vi.stubGlobal("RTCPeerConnection",class {connectionState="new";close=vi.fn(()=>closed.push(this))})
    await installScreenCapture()
    const first=remoteCameraStream("one").catch(error=>error)
    const firstKey=emit.mock.calls.at(-1)![1].key
    await vi.advanceTimersByTimeAsync(15000)
    expect(await first).toBeInstanceOf(Error)
    expect(closed).toHaveLength(1)
    await signal.fn({payload:{type:"camera-error",key:firstKey,sender:"remote",error:"Late error"}})
    expect(closed).toHaveLength(1)
    const second=remoteCameraStream("two").catch(error=>error)
    const secondKey=emit.mock.calls.at(-1)![1].key
    expect(secondKey).not.toBe(firstKey)
    await signal.fn({payload:{type:"camera-error",key:secondKey,sender:"remote",error:"Device in use"}})
    expect((await second).message).toBe("Device in use")
    expect(closed).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(15000)
    expect(closed).toHaveLength(2)
})
