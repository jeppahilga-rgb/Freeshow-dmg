import { expect, it, vi } from "vitest"
import { installOutputEscapeHandlers } from "./outputSafety"
function fixture(label: string) {
    const handlers: Record<string, Function> = {}
    const exit = vi.fn(async () => {})
    const target = { addEventListener: vi.fn((name, fn) => { handlers[name] = fn }) }
    installOutputEscapeHandlers(target as any, label, exit)
    return { handlers, exit, target }
}
it("double-click dismisses output before website/media handlers", () => {
    const { handlers, exit, target } = fixture("output-center")
    const event = { preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() }
    handlers.dblclick(event)
    expect(exit).toHaveBeenCalledTimes(1)
    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1)
    expect(target.addEventListener).toHaveBeenCalledWith("dblclick", expect.any(Function), true)
})
it("Escape dismisses focused output and ignores other keys", () => {
    const { handlers, exit } = fixture("output-center")
    const event = { key: "Escape", preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() }
    handlers.keydown({ ...event, key: "Enter" }); expect(exit).not.toHaveBeenCalled()
    handlers.keydown(event); expect(exit).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
})
it("editor double-click remains available and Escape retains normal event handling", () => {
    const { handlers, exit } = fixture("main")
    expect(handlers.dblclick).toBeUndefined()
    const event = { key: "Escape", preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() }
    handlers.keydown(event); expect(exit).toHaveBeenCalledTimes(1)
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled()
})
