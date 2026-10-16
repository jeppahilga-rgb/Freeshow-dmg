import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { defaultSettings, defaultSyncedSettings } from "../../electron/data/defaults"
import { searchLyrics, getLyrics } from "./lyrics"
import { installScreenCapture, screenSources } from "./screenCapture"
import { mediaThumbnail } from "./media"
import { detectFileType } from "../../electron/data/bibleDetecter"
import { parsePowerPointPackage } from "./powerpoint"
import { importDocument } from "./documentImport"
import { tauriImportKinds } from "./capabilities"
import { backendCommands, backendService, decodeBackend } from "./backendServices"
import { desktopCommands, midiCommands, desktopService } from "./desktopServices"
import { createAudioTransport } from "./audioTransport"
import {connectMediaTransport,setBlackmagicDispatch} from './mediaTransport'
import {correctSpelling} from './spelling'
import {handleWhipHost} from './whipHost'
import { installOutputEscapeHandlers } from "./outputSafety"

type Message = { channel: string; data?: any; [key: string]: any }
type Receiver = { channel: string; fn: (msg: Message, id?: string) => unknown; id?: string }

export async function installTauriBridge() {
    installOutputEscapeHandlers(window, getCurrentWindow().label, () => invoke("exit_fullscreen"))
    await installScreenCapture()
    const receivers: Receiver[] = []
    const unsupported = new Set<string>()
    const dispatch = (channel: string, msg: Message, id?: string) => {
        if(channel==='MEDIA_TRANSPORT'){connectMediaTransport(msg.data.url);return}
        if(channel==='WHIP_HOST'){handleWhipHost(msg);return}
        for (const receiver of [...receivers]) if (receiver.channel === channel) {
            const failure = (error: unknown) => {
                report(msg.channel, error)
                if (msg.channel === "IMPORT2") dispatch("MAIN", { channel: "ALERT", data: `Import failed: ${String(error)}` })
            }
            try {
                const result = receiver.fn(msg, id)
                if (result && typeof (result as any).catch === "function") (result as Promise<unknown>).catch(failure)
            } catch (error) { failure(error) }
        }
    }
    const defaults = structuredClone(defaultSettings)
    setBlackmagicDispatch(data=>dispatch('BLACKMAGIC',{channel:'RECEIVE_STREAM',data}))
    defaults.initialized = true
    defaults.alertUpdates = false
    defaults.disabledServers = { remote: true, stage: true, output_stream: "", controller: true }
    defaults.special = { autoBackup: "never" }
    const synced = structuredClone(defaultSyncedSettings)
    const importTextFiles = async (kind: string, paths: string[]) => {
        if (kind === "pdf" || kind === "powerpoint_pdf") {
            for (const path of paths) {
                const name = path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "")
                const progress = (value: number, status = "importing", message?: string) => dispatch("MAIN", { channel: "PDF_IMPORT_PROGRESS", data: { filePath: path, name, progress: value, total: 100, status, message } })
                try {
                    const result = await importDocument(path, value => progress(value))
                    dispatch("MAIN", { channel: "IMAGES_TO_SHOW", data: result })
                    progress(100, "complete")
                } catch (error) { progress(0, "error", String(error)); throw error }
            }
            return
        }
        if (kind === "powerpoint" || kind === "powerpoint_editable") {
            const files = []
            for (const path of paths) {
                const raw = await invoke<any>("import_powerpoint", { path })
                files.push({ name: path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, ""), content: parsePowerPointPackage(raw) })
            }
            if (files.length) dispatch("MAIN", { channel: "IMPORT2", data: { channel: "powerpoint", data: files } })
            return
        }
        if (!tauriImportKinds.has(kind)) throw Error(`The ${kind} import converter is not available in Tauri yet`)
        const originalBinaryFormats = ["word", "propresenter", "easyworship", "openlp", "mediashout", "quelea", "softprojector"]
        if (originalBinaryFormats.includes(kind) || paths.some(path => /\.(zip|probundle|vpc|qsp|pro|mdb|db|sqlite)$/i.test(path)) && ["videopsalm", "BIBLE", "freeshow_project", "freeshow_template", "freeshow_overlay"].includes(kind)) {
            await backendService("IMPORT_BINARY", {kind, paths}); return
        }
        const files = []
        for (const path of paths) {
            const packageImport = ["freeshow_project", "freeshow_template", "freeshow_overlay"].includes(kind)
            if (!packageImport && /\.(zip|probundle|vpc|qsp|docx?|pptx?|mdb|db|sqlite)$/i.test(path)) throw Error("Use the matching import format for this binary or archive file")
            const result = await invoke<any>("library_service", { operation: packageImport ? "IMPORT_PACKAGE" : "READ_FILE", data: { path } })
            const filename = path.split(/[\\/]/).pop() || path
            files.push({ content: result.content, path, name: filename.replace(/\.[^.]+$/, ""), extension: filename.split(".").pop()?.toLowerCase(), ...(kind === "BIBLE" ? { type: detectFileType(result.content) } : {}) })
        }
        if (files.length) dispatch("MAIN", { channel: "IMPORT2", data: { channel: kind, data: files } })
    }
    const stores = new Set(["SETTINGS", "SYNCED_SETTINGS", "STAGE", "PROJECTS", "OVERLAYS", "TEMPLATES", "EVENTS", "MEDIA", "THEMES", "DRIVE_API_KEY", "HISTORY", "CACHE", "USAGE"])
    const report = (name: string, error: unknown) => {
        if (unsupported.has(name)) return
        unsupported.add(name)
        console.warn(`[Tauri preview] ${name}:`, error)
        if (getCurrentWindow().label !== "main" || ["REMOTE", "STAGE", "CONTROLLER", "OUTPUT_STREAM", "CHECK_RAM_USAGE", "CAPTURE", "REQUEST_PREVIEW"].includes(name)) return
        const status = document.getElementById("tauri-status")
        if (status) { status.textContent = `FreeShow+ preview: ${name} — ${String(error)}`; status.hidden = false }
    }
    const audioTransport = createAudioTransport(error => report("AUDIO", error))
    await listen<{ channel: string; msg: Message; id?: string }>("freeshow-ipc", ({ payload }) => dispatch(payload.channel, decodeBackend(payload.msg), payload.id), { target: getCurrentWindow().label })
    document.addEventListener("mousedown", (event) => {
        const target = event.target as HTMLElement
        if (event.button !== 0 || target.closest("button,input,a,.menus,.window")) return
        if ((getCurrentWindow().label === "main" && event.clientY < 25) || target.closest(".dragger")) void invoke("window_action", { action: "DRAG" })
    })
    async function send(channel: string, msg: Message = { channel: "" }, id?: string) {
        try {
            if (channel === "STARTUP") {
                const label=getCurrentWindow().label
                dispatch(channel, { channel: "TYPE", data: label === "main" ? null : label.startsWith('pdf-')?'pdf':"output" })
                if(label.startsWith('pdf-')){const data=await invoke<any>('pdf_export',{operation:'DATA',data:null});dispatch('EXPORT',{channel:'PDF',data})}
                return
            }
            if (channel === "LOADED") return
            if (channel === "AUDIO") { await audioTransport(msg); return }
            if (channel === "OUTPUT") { await invoke("output_message", { msg }); return }
            if (["REMOTE", "STAGE", "CONTROLLER", "OUTPUT_STREAM"].includes(channel)) { await invoke("local_server_send", { kind: channel.toLowerCase(), msg }); return }
            if(channel==='CLOUD'){const response=await backendService('LEGACY_CLOUD',{message:msg});if(response)dispatch('CLOUD',response,id);return}
            if (channel === "EXPORT") {
                if(getCurrentWindow().label.startsWith('pdf-')){
                    if(msg.channel==='EXPORT'){await document.fonts.ready;await Promise.all([...document.images].map(image=>image.complete?Promise.resolve():new Promise<void>(resolve=>{image.onload=()=>resolve();image.onerror=()=>resolve();setTimeout(resolve,10000)})));await invoke('pdf_export',{operation:'PRINT',data:msg.data});dispatch('EXPORT',{channel:'NEXT'})}
                    else if(msg.channel==='DONE')await invoke('pdf_export',{operation:'DONE',data:null});return
                }
                if(msg.channel==='GENERATE'&&msg.data?.type==='pdf'){await invoke('pdf_export',{operation:'START',data:msg.data});return}
                const result = await invoke<any>("export_library", { msg }); if (result?.files?.length) dispatch("MAIN", { channel: "TOAST", data: "actions.exported" }); return
            }
            if(['NDI','OMT','BLACKMAGIC'].includes(channel)){
                if(['RECEIVE_FRAME','RECEIVE_STREAM','CAPTURE_STREAM'].includes(msg.channel)){const target=getCurrentWindow().label==='main'?'app':getCurrentWindow().label.replace(/^output-/,'');const connection=await backendService('MEDIA_TRANSPORT',{target});connectMediaTransport(connection.url)}
                const result=await backendService('MEDIA_CHANNEL',{channel,message:msg});if(result!==null)dispatch(channel,{channel:msg.channel,data:JSON.stringify(result)},id);return
            }
            if (channel !== "MAIN") { report(channel, "Integration has not been ported yet"); return }
            if (id?.startsWith("worker-reply-")) { await backendService("REPLY", { id, msg }); return }
            const key = msg.channel
            if(key==='SPELLCHECK'){await correctSpelling(msg.data);return}
            if(key==='CAPTURE_SLIDE'){dispatch('MAIN',{channel:key,data:await invoke('capture_slide',{data:msg.data})},id);return}
            if(key==='UPDATE_DATA_PATH'){await invoke('set_data_folder',{path:msg.data.newPath});dispatch('MAIN',{channel:'ALERT',data:'Data folder updated. Restart FreeShow to load the selected library.'});return}
            if(key==='STOP'){for(const kind of ['remote','stage','controller','output_stream','companion'])await invoke('local_server_stop',{kind});return}
            if (backendCommands.has(key)) { const result = await backendService(key, msg.data ?? null); dispatch("MAIN", { channel: key, data: result }, id); return }
            if (desktopCommands.has(key) || midiCommands.has(key)) {
                const result = await desktopService(key, msg.data)
                dispatch("MAIN", { channel: key === "REFRESH_SHOWS" ? "REFRESH_SHOWS2" : key, data: result }, id)
                if (["DELETE_SHOWS", "DELETE_SHOWS_NI"].includes(key)) dispatch("MAIN", { channel: "REFRESH_SHOWS2", data: await desktopService("REFRESH_SHOWS", null) })
                return
            }
            if (["ALERT", "TOAST"].includes(key)) { dispatch("MAIN", msg); return }
            if (key === "PDF_TO_IMAGE") { await importTextFiles("pdf", [msg.data.filePath]); return }
            if (key === "PPT_TO_PDF") {
                const chosen = await invoke<any>("pick_media_files", { data: { title: "Import PowerPoint", filter: { name: "PowerPoint", extensions: ["ppt", "pptx"] }, multiple: false } })
                await importTextFiles("powerpoint_pdf", chosen.files)
                return
            }
            if (["BACKUPS", "DELETE_BACKUP", "RESTORE"].includes(key)) {
                const result = await invoke<any>("backup_service", { operation: key, path: msg.data?.path || null })
                if (key === "RESTORE") {
                    if (result) {
                        for (const [store, value] of Object.entries(result.stores || {})) dispatch("MAIN", { channel: store, data: value })
                        dispatch("MAIN", { channel: "SHOWS", data: result.shows })
                    }
                    dispatch("MAIN", { channel: "RESTORE2", data: { finished: !!result } })
                } else dispatch("MAIN", { channel: key, data: result }, id)
                return
            }
            let data: any
            if (key === "IMPORT") {
                if (!tauriImportKinds.has(msg.data.channel)) throw Error(`The ${msg.data.channel} import converter is not available in Tauri yet`)
                const chosen = await invoke<any>("pick_media_files", { data: { title: "Import files", filter: msg.data.format, multiple: true } })
                await importTextFiles(msg.data.channel, chosen.files)
                return
            }
            if (key === "IMPORT_FILES") { await importTextFiles(msg.data.id, msg.data.paths); return }
            if (["BIBLE", "READ_BIBLES_FOLDER", "READ_FILE", "FILE_INFO", "READ_AUDIO_METADATA", "FULL_SHOWS_LIST", "GET_STORE_VALUE"].includes(key)) {
                data = await invoke("library_service", { operation: key, data: msg.data ?? null })
                dispatch("MAIN", { channel: key, data }, id)
                return
            }
            if (key === "START") {
                await invoke("local_server_data", { data: msg.data.data || {} })
                const defaultPorts = { remote: 5510, stage: 5511, controller: 5512, output_stream: 5513 }
                for (const [kind, fallback] of Object.entries(defaultPorts)) {
                    try {
                        if (msg.data.disabled?.[kind] === false) await invoke("local_server_start", { kind, port: Number(msg.data.ports?.[kind] || fallback), max: msg.data.max || 10 })
                        else await invoke("local_server_stop", { kind })
                    } catch (error) { report(`${kind} server`, error) }
                }
                if (msg.data.data?.companion?.enabled) await invoke("local_server_start", { kind: "companion", port: Number(msg.data.ports?.companion || 5505), password: msg.data.data.companion.password || "" })
                else await invoke("local_server_stop", { kind: "companion" })
                return
            }
            if (key === "SERVER_DATA") { await invoke("local_server_data", { data: msg.data }); return }
            if (key === "WEBSOCKET_START") { await invoke("local_server_start", { kind: "companion", port: Number(msg.data?.port || 5505), password: msg.data?.password || "" }); return }
            if (key === "WEBSOCKET_STOP") { await invoke("local_server_stop", { kind: "companion" }); return }
            if (key === "API_TRIGGER") { await invoke("local_api_return", { msg: msg.data }); return }
            if (key === "GET_DYNAMIC_VALUES") { await invoke("local_api_return", { msg: { returnId: id, isVariable: true, values: msg.data } }); return }
            if (key === "OPEN_FOLDER") {
                const path = await invoke("pick_folder", { title: msg.data.title || "Choose folder", path: msg.data.path || null })
                dispatch("MAIN", { channel: "OPEN_FOLDER2", data: { channel: msg.data.channel, path } })
                return
            }
            else if (key === "OPEN_FOLDER_PATH") { await invoke("open_folder_path", { path: msg.data }); return }
            else if (key === "OPEN_FILE") {
                const result = await invoke<any>("pick_media_files", { data: msg.data })
                if (result.files.length) dispatch("MAIN", { channel: "OPEN_FILE2", data: result })
                return
            }
            else if (["READ_FOLDER", "DOES_MEDIA_EXIST", "LOCATE_MEDIA_FILE"].includes(key)) data = await invoke("media_files", { operation: key, data: msg.data })
            else if (key === "GET_THUMBNAIL") data = await mediaThumbnail(msg.data.input, msg.data.size)
            else if (key === "GET_MEDIA_FOLDER_PATH") data = `${await invoke("app_info", { key: "DATA_PATH" })}\\Media`
            else if (key === "IP") data = await invoke("network_ips")
            else if (key === "SPOTIFY_GET_STATE") data = await invoke("spotify_service", { command: "state", value: null })
            else if (key === "SPOTIFY_COMMAND") data = await invoke("spotify_service", { command: msg.data.command, value: msg.data.value ?? null })
            else if (key === "URL") { await invoke("open_url", { url: msg.data }); return }
            else if (key === "SEARCH_LYRICS") data = await searchLyrics(msg.data)
            else if (key === "GET_LYRICS") data = await getLyrics(msg.data.song)
            else if (key === "GET_SCREENS" || key === "GET_WINDOWS") data = screenSources()
            else if (["ACCESS_CAMERA_PERMISSION", "ACCESS_MICROPHONE_PERMISSION", "ACCESS_SCREEN_PERMISSION"].includes(key)) return
            else if (stores.has(key)) {
                data = await invoke("read_store", { key })
                if (key === "SETTINGS") data = { ...defaults, ...data }
                if (key === "SYNCED_SETTINGS") data = { ...synced, ...data }
                if (key === "PROJECTS") data = { projects: {}, folders: {}, projectTemplates: {}, ...data }
            } else if (key === "SHOWS") data = await invoke("show_index")
            else if (key === "SHOW") data = await invoke("read_show", { id: msg.data.id })
            else if (key === "SAVE") {
                const result = await invoke<any>("save_library", { data: msg.data })
                if (result?.backupPath) dispatch("MAIN", { channel: "BACKUP", data: { finished: true, path: result.backupPath } })
                dispatch("MAIN", { channel: "SAVE2", data: { closeWhenFinished: msg.data.closeWhenFinished, customTriggers: msg.data.customTriggers || {} } })
                return
            } else if (key === "OUTPUT") data = getCurrentWindow().label === "main" ? "false" : "true"
            else if (["CLOSE", "MINIMIZE", "MAXIMIZE", "MAXIMIZED", "FULLSCREEN", "GET_DISPLAYS"].includes(key)) data = await invoke("window_action", { action: key })
            else if (["VERSION", "IS_DEV", "GET_OS", "GET_CACHE_PATH", "DATA_PATH", "DEVICE_ID"].includes(key)) data = await invoke("app_info", { key })
            else if (key === "GET_CONTENT_PROVIDERS") data = []
            else if (key === "PROVIDER_CONNECTIONS") data = {}
            else if (["START", "LANGUAGE", "LOG", "LOG_ERROR", "PROVIDER_STARTUP_LOAD"].includes(key)) return
            else {
                const first = !unsupported.has(key)
                report(key, "Feature has not been ported yet")
                if (first && !["CHECK_RAM_USAGE", "REQUEST_PREVIEW", "GET_DEVICE_NAME"].includes(key)) dispatch("MAIN", { channel: "ALERT", data: `${key} is not available in this Tauri build.` })
                data = null
            }
            dispatch("MAIN", { channel: key, data }, id)
        } catch (error) {
            report(msg.channel || channel, error)
            if (msg.channel === "SAVE") dispatch("MAIN", { channel: "SAVE_ERROR", data: { message: String(error) } })
            if (channel === "EXPORT" || ["BACKUPS", "DELETE_BACKUP", "RESTORE"].includes(msg.channel)) dispatch("MAIN", { channel: "ALERT", data: `${msg.channel || channel} failed: ${String(error)}` })
            if (["IMPORT", "IMPORT_FILES", "PDF_TO_IMAGE", "PPT_TO_PDF"].includes(msg.channel)) dispatch("MAIN", { channel: "ALERT", data: `Import failed: ${String(error)}` })
            if (["SEARCH_LYRICS", "GET_LYRICS"].includes(msg.channel)) {
                dispatch(channel, { channel: msg.channel, data: { error: String(error) } }, id)
                return
            }
            if (id) dispatch(channel, { channel: msg.channel, data: null }, id)
        }
    }
    window.api = {
        send(channel, data, id) { queueMicrotask(() => void send(channel, data, id)) },
        receive(channel, fn, id) {
            if (id) this.removeListener(channel, id)
            receivers.push({ channel, fn, id })
        },
        removeListener(channel, id) {
            for (let i = receivers.length - 1; i >= 0; i--) if (receivers[i].channel === channel && receivers[i].id === id) receivers.splice(i, 1)
        },
        getListeners() { return [...new Set(receivers.map(r => r.channel))].map(c => [c, receivers.filter(r => r.channel === c).length]) },
        showFilePath(file) { return typeof file === "string" ? file : (file as any)?.path || "" }
    } as typeof window.api
    if (getCurrentWindow().label === "main") {
        const status = document.createElement("div")
        status.id = "tauri-status"
        status.textContent = "FreeShow+ preview • Integration ports included • Some features still need testing"
        status.style.cssText = "position:fixed;bottom:0;left:0;right:0;z-index:100000;background:#242030;color:#ddd;padding:4px 10px;font:11px sans-serif;pointer-events:none"
        document.body.style.height = "calc(100% - 22px)"
        status.style.height = "22px"
        status.style.whiteSpace = "nowrap"
        status.style.overflow = "hidden"
        status.style.textOverflow = "ellipsis"
        document.body.append(status)
    }
}
