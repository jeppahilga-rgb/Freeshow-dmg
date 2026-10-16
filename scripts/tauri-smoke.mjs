import { chromium } from "playwright"
import fs from "node:fs/promises"
import assert from "node:assert/strict"
import path from "node:path"

const browser = await chromium.connectOverCDP("http://127.0.0.1:9223")
const context = browser.contexts()[0]
let main
for (const page of context.pages()) {
    if (page.url() === "about:blank") continue
    if (await page.evaluate(() => window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label) === "main") main=page
}
if (!main) throw new Error("FreeShow main page not found")
const errors = []
main.on("pageerror", error => errors.push(error.message))
await main.reload()
await main.waitForFunction(() => window.api && window.__TAURI_INTERNALS__, null, { timeout: 30000 })
await main.waitForTimeout(10000)
await fs.mkdir("tauri-test-output", { recursive: true })
await main.screenshot({ path: "tauri-test-output/editor.png" })
console.log("Editor:", (await main.locator("body").innerText()).slice(0, 1800))
console.log("Page errors:", errors)
const dataPath=await main.evaluate(() => window.__TAURI_INTERNALS__.invoke("app_info", { key: "DATA_PATH" }))
console.log("App info:", dataPath)
assert.match(await main.locator("body").innerText(), /New show/)
// Exercise the real frontend save routine against the Rust backend in development mode.
if (main.url().startsWith("http://127.0.0.1:3000")) {
    const sourceBase=await main.evaluate(() => performance.getEntriesByType("resource").map(e=>e.name).find(url=>url.endsWith("/src/frontend/stores.ts")).replace(/stores\.ts$/, ""))
    await main.evaluate(async (sourceBase) => {
        const stores=await import(sourceBase+"stores.ts")
        let outputs
        stores.outputs.subscribe(value=>outputs=value)()
        if (!outputs.default) {
            const { defaultSettings }=await import(sourceBase+"../electron/data/defaults.ts")
            stores.outputs.set(structuredClone(defaultSettings.outputs))
        }
        const { createDefaultShow } = await import(sourceBase+"utils/createData.ts")
        const { save } = await import(sourceBase+"utils/save.ts")
        createDefaultShow()
        save()
    }, sourceBase)
    await main.waitForFunction(async () => !!(await window.__TAURI_INTERNALS__.invoke("show_index")).default)
    const before = await main.evaluate(() => window.__TAURI_INTERNALS__.invoke("read_show", { id: "default" }))
    assert.equal(before.content[1].settings.activeLayout, "default")
    await main.reload()
    await main.getByText(before.content[1].name, { exact: true }).first().waitFor({ timeout: 30000 })
    await main.getByText(before.content[1].name, { exact: true }).first().click()
    await main.waitForTimeout(1500)
    const after = await main.evaluate(() => window.__TAURI_INTERNALS__.invoke("read_show", { id: "default" }))
    assert.deepEqual(after, before)
    console.log("PASS: frontend save and library reload")
    const outputData = await main.evaluate(async (sourceBase) => {
        const stores = await import(sourceBase+"stores.ts")
        let outputs
        stores.outputs.subscribe(value => outputs=value)()
        return { id: "default", ...outputs.default }
    }, sourceBase)
    await main.evaluate(output => window.__TAURI_INTERNALS__.invoke("output_message", { msg: { channel: "TOGGLE_OUTPUTS", data: { outputs: [output], state: true } } }), outputData)
    let output
    for (let i=0;i<30;i++) {
        for (const candidate of context.pages()) {
            if (candidate===main || candidate.url()==="about:blank") continue
            const label=await candidate.evaluate(() => window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label)
            if (label==="output-default") output=candidate
        }
        if (output) break
        await main.waitForTimeout(500)
    }
    assert.ok(output, "Presentation window should open")
    output.on("pageerror", error => errors.push(error.message))
    await main.evaluate(async (sourceBase) => {
        const { setOutput } = await import(sourceBase+"components/helpers/output.ts")
        setOutput("slide", { id: "default", layout: "default", index: 0 })
    }, sourceBase)
    await output.getByText("Welcome!", { exact: true }).first().waitFor({ timeout: 30000 })
    await output.waitForTimeout(1000)
    await output.screenshot({ path: "tauri-test-output/output.png" })
    console.log("PASS: slide rendered in separate presentation window")
    await main.evaluate(output => window.__TAURI_INTERNALS__.invoke("output_message", { msg: { channel: "TOGGLE_OUTPUTS", data: { outputs: [output], state: false } } }), outputData)
    await main.screenshot({ path: "tauri-test-output/editor.png" })
} else {
    const index=await main.evaluate(() => window.__TAURI_INTERNALS__.invoke("show_index"))
    if (index.default) {
        await main.getByText(index.default.name, { exact: true }).first().click()
        await main.keyboard.press("Control+s")
        await main.waitForTimeout(2000)
        const serialized=JSON.parse(await fs.readFile(path.join(dataPath,"shows","default.show"),"utf8"))
        assert.equal(serialized[0],"default","Saved show uses FreeShow's [id, show] format")
        await main.locator(".slide").first().click()
        await main.locator("#output_window_button").click()
        let output
        for (let i=0;i<30;i++) {
            for (const candidate of context.pages()) {
                if (candidate===main || candidate.url()==="about:blank") continue
                if (await candidate.evaluate(() => window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label)==="output-default") output=candidate
            }
            if (output) break
            await main.waitForTimeout(500)
        }
        assert.ok(output, "Presentation window opens through the UI")
        output.on("pageerror", error=>errors.push(error.message))
        await output.getByText("Welcome!", { exact: true }).first().waitFor({timeout:30000})
        await output.waitForTimeout(1000)
        await output.screenshot({path:"tauri-test-output/output.png"})
        await main.locator("#output_window_button").click()
        await main.locator("#output_window_button").click()
        await main.waitForTimeout(1000)
        assert.ok(output.isClosed(), "Disabled output webview is destroyed")
        await main.screenshot({path:"tauri-test-output/editor.png"})
        console.log("PASS: packaged UI presents a slide and destroys disabled output")
    }
}
assert.deepEqual(errors, [], "No unhandled frontend errors")
await browser.close()
