import { expect, it, vi } from "vitest"
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke, convertFileSrc: (path: string) => path }))
import { mediaThumbnail } from "../src/frontend/tauri/media"

it("revalidates thumbnail after the backend cache changes", async () => {
    invoke.mockResolvedValue({ input: "C:/audit/replaced.jpg", output: "C:/cache/old.png", size: 250 })
    const first = await mediaThumbnail("C:/audit/replaced.jpg")
    invoke.mockResolvedValue({ input: "C:/audit/replaced.jpg", output: "C:/cache/new.png", size: 250 })
    const second = await mediaThumbnail("C:/audit/replaced.jpg")
    expect(first?.output).toBe("C:/cache/old.png")
    expect(second?.output).toBe("C:/cache/new.png")
    expect(invoke).toHaveBeenCalledTimes(2)
})
