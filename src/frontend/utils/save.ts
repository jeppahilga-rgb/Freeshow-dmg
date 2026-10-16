import { get } from "svelte/store"
import { Main } from "../../types/IPC/Main"
import type { Projects } from "../../types/Projects"
import type { Shows } from "../../types/Show"
import { stopAllChannelRecordings } from "../audio/audioChannelRecorder"
import { customActionActivation } from "../components/actions/actions"
import { stopMediaRecorder } from "../components/drawer/live/recorder"
import { stopAllInteractions } from "../components/drawer/pages/interactions"
import { clone, keysToID, removeDeleted } from "../components/helpers/array"
import { isOutCleared, updateSyncedOutputs } from "../components/helpers/output"
import { sendMain } from "../IPC/main"
import {
    actionTags,
    actions,
    activePopup,
    activeProject,
    activeScenes,
    ai,
    alertMessage,
    alertUpdates,
    audioChannelsData,
    audioEffectPresets,
    audioEffects,
    audioFolders,
    audioPlaylists,
    audioRouting,
    audioStreams,
    autoOutput,
    autosave,
    calendarAddShow,
    calendars,
    categories,
    cloudSyncData,
    contentProviderData,
    customFonts,
    customMetadata,
    customizedIcons,
    deletedDefaults,
    deletedShows,
    disabledServers,
    drawSettings,
    drawer,
    drawerTabsData,
    driveData,
    driveKeys,
    effects,
    effectsLibrary,
    emitters,
    errorHasOccurred,
    events,
    folders,
    formatNewShow,
    fullColors,
    globalRegexes,
    globalTags,
    groupNumbers,
    groups,
    interactions,
    labelsDisabled,
    language,
    lockedOverlays,
    maxConnections,
    media,
    mediaFolders,
    mediaOptions,
    mediaTags,
    metronome,
    obsData,
    openedFolders,
    outLocked,
    outputs,
    overlayCategories,
    overlays,
    playerTags,
    playerVideos,
    ports,
    profiles,
    projectTemplates,
    projects,
    providerConnections,
    redoHistory,
    renamedShows,
    resized,
    saved,
    scenes,
    scriptureSettings,
    scriptures,
    scripturesCache,
    serverData,
    shows,
    showsCache,
    slidesOptions,
    sorted,
    special,
    splitLines,
    stageShows,
    statusIndicator,
    styles,
    syncedOutputs,
    templateCategories,
    templates,
    textCache,
    theme,
    themes,
    timeFormat,
    timecode,
    timeline,
    timerTags,
    timers,
    transitionData,
    undoHistory,
    usageLog,
    variableTags,
    variables,
    videoMarkers
} from "../stores"
import type { SaveActions, SaveData, SaveList, SaveListSettings, SaveListSyncedSettings } from "./../../types/Save"
import { isSyncing, socketDisconnect, syncWithCloud } from "./cloudSync"
import { newToast, setStatus, startAutosave } from "./common"
import { syncDrive } from "./drive"
import { autoDisableRemoteController, stopRemoteController } from "./remoteController"

let pendingSave: { deleted: any[]; renamed: any[]; revision: number } | null = null
let saveRevision = 0
let closeAfterSave = false
let unsavedTracking = false

export function save(closeWhenFinished = false, customTriggers: SaveActions = {}) {
    unsavedUpdater()
    updateSyncedOutputs()
    startAutosave() // reset auto save timer

    // don't save again while saving
    if (pendingSave || get(statusIndicator) === "saving") {
        if (closeWhenFinished) closeAfterSave = true
        return
    }

    console.info("SAVING...")
    if ((!customTriggers.autosave || !get(saved)) && !customTriggers.backup) {
        setStatus("saving")
        customActionActivation("save")
    }

    if (closeWhenFinished) {
        alertMessage.set("actions.closing")
        activePopup.set("alert")
    }

    // strip runtime state that should not save
    const sanitizedOutputs = clone(get(outputs))
    Object.values(sanitizedOutputs).forEach((out: any) => {
        if (out.webrtcData) out.webrtcData.streaming = false
        if (out.rtmpData) out.rtmpData.streaming = false
    })

    const settings: { [key in SaveListSettings]: any } = {
        initialized: true,
        activeProject: get(activeProject),
        alertUpdates: get(alertUpdates),
        audioFolders: get(audioFolders),
        autoOutput: get(autoOutput),
        maxConnections: get(maxConnections),
        ports: get(ports),
        disabledServers: get(disabledServers),
        serverData: get(serverData),
        autosave: get(autosave),
        timeFormat: get(timeFormat),
        // events: get(events),
        lockedOverlays: get(lockedOverlays),
        activeScenes: get(activeScenes),
        drawer: get(drawer),
        drawerTabsData: get(drawerTabsData),
        groupNumbers: get(groupNumbers),
        fullColors: get(fullColors),
        formatNewShow: get(formatNewShow),
        labelsDisabled: get(labelsDisabled),
        language: get(language),
        customFonts: get(customFonts),
        mediaFolders: get(mediaFolders),
        mediaOptions: get(mediaOptions),
        openedFolders: get(openedFolders),
        outLocked: get(outLocked),
        outputs: sanitizedOutputs,
        sorted: get(sorted),
        resized: get(resized),
        slidesOptions: get(slidesOptions),
        splitLines: get(splitLines),
        // templates: get(templates),
        theme: get(theme),
        transitionData: get(transitionData),
        // themes: get(themes),
        audioRouting: get(audioRouting),
        audioChannelsData: get(audioChannelsData),
        cloudSyncData: get(cloudSyncData),
        driveData: get(driveData),
        calendarAddShow: get(calendarAddShow),
        metronome: get(metronome),
        audioEffects: get(audioEffects),
        audioEffectPresets: get(audioEffectPresets),
        effectsLibrary: get(effectsLibrary),
        special: get(special),
        timeline: get(timeline),
        timecode: get(timecode),
        contentProviderData: get(contentProviderData),
        obsData: get(obsData),
        ai: get(ai)
    }

    const syncedSettings: { [key: string]: any } = {}
    Object.entries(getSyncedSettings()).forEach(([key, store]) => {
        syncedSettings[key] = get(store)
    })

    const allSavedData: SaveData = {
        // SETTINGS
        SETTINGS: settings,
        SYNCED_SETTINGS: syncedSettings,
        // SHOWS
        SHOWS: get(shows),
        STAGE: get(stageShows),
        // STORES
        PROJECTS: { projects: get(projects), folders: get(folders), projectTemplates: get(projectTemplates) },
        OVERLAYS: get(overlays),
        TEMPLATES: get(templates),
        EVENTS: get(events),
        MEDIA: get(media),
        THEMES: get(themes),
        DRIVE_API_KEY: get(driveKeys),
        // CACHES SAVED TO MULTIPLE FILES
        showsCache: get(showsCache),
        scripturesCache: get(scripturesCache),
        deletedShows: get(deletedShows),
        renamedShows: get(renamedShows),
        // CACHES
        CACHE: { text: get(textCache) },
        HISTORY: { undo: get(undoHistory), redo: get(redoHistory) },
        USAGE: get(usageLog),
        // SAVE INFO DATA
        closeWhenFinished,
        customTriggers
    }

    const saveData = clone(allSavedData)

    pendingSave = { deleted: saveData.deletedShows || [], renamed: saveData.renamedShows || [], revision: saveRevision }

    if (customTriggers.backup) newToast("settings.backup_started")
    // trigger toast before saving
    setTimeout(() => sendMain(Main.SAVE, saveData))
}

export function getSyncedSettings(): { [key in SaveListSyncedSettings]: any } {
    return {
        categories,
        drawSettings,
        groups,
        overlayCategories,
        scriptures,
        scriptureSettings,
        templateCategories,
        styles,
        profiles,
        timers,
        variables,
        scenes,
        interactions,
        audioStreams,
        audioPlaylists,
        midiIn: actions,
        emitters,
        playerVideos,
        videoMarkers,
        calendars,
        mediaTags,
        playerTags,
        actionTags,
        variableTags,
        timerTags,
        customizedIcons,
        globalTags,
        globalRegexes,
        customMetadata,
        effects,
        deletedDefaults,
        syncedOutputs
    }
}

export function saveFailed(message: string) {
    pendingSave = null
    closeAfterSave = false
    saved.set(false)
    setStatus("")
    alertMessage.set(`Could not save. Your changes are still in memory. Please retry saving before closing.\n${message}`)
    activePopup.set("alert")
}

export async function saveComplete({ closeWhenFinished, customTriggers }: { closeWhenFinished: boolean; customTriggers?: SaveActions }) {
    const pending = pendingSave
    pendingSave = null
    const changedDuringSave = !!pending && pending.revision !== saveRevision
    if (pending) {
        const removeAcknowledged = (current: any[], acknowledged: any[]) => current.filter(item => !acknowledged.some(old => JSON.stringify(old) === JSON.stringify(item)))
        deletedShows.update(current => removeAcknowledged(current, pending.deleted))
        renamedShows.update(current => removeAcknowledged(current, pending.renamed))
    }
    if (customTriggers?.backup) special.update(s => ({ ...s, autoBackupPrevious: Date.now() - 3600000 }))
    closeWhenFinished ||= closeAfterSave
    closeAfterSave = false
    if (changedDuringSave && closeWhenFinished) {
        setStatus("")
        save(true)
        return
    }
    const alreadySaved = get(saved)
    if (!closeWhenFinished) {
        if ((!customTriggers?.autosave || !alreadySaved) && !customTriggers?.backup) setStatus("saved", 1)

        saved.set(!changedDuringSave)
        console.info("SAVED!")
    }

    // cloud sync (only when autosaving or closing)
    if ((customTriggers?.autosave || closeWhenFinished) && (get(providerConnections).churchApps || !get(driveData)?.mainFolderId)) {
        if (closeWhenFinished) {
            alertMessage.set("actions.closing")
            activePopup.set("alert")
        }

        let shouldSync = true
        if (customTriggers?.autosave) {
            // don't sync if already saved or if a slide is currently outputted or if cloud sync is in progress
            if (alreadySaved || !isOutCleared("slide") || isSyncing) shouldSync = false
        }

        if (shouldSync) await syncWithCloud(false, closeWhenFinished)

        if (closeWhenFinished) {
            await socketDisconnect()
            closeApp()
        }
        return
    }

    if (customTriggers?.backup || customTriggers?.reset) return

    // DEPRECATED drive sync
    const mainFolderId = get(driveData)?.mainFolderId
    if (!mainFolderId || get(driveData)?.disabled === true || !Object.keys(get(driveKeys)).length) {
        if (closeWhenFinished) closeApp()

        return
    }

    syncDrive(false, closeWhenFinished)
}

export function initializeClosing(skipPopup = false) {
    if (pendingSave) { closeAfterSave = true; return }
    // don't save automatically if an error has happened in case it breaks something
    if (!skipPopup && (get(special).showClosePopup || get(errorHasOccurred))) activePopup.set("unsaved")
    // "saved" does not count for all minor changes, but should be fine
    else if (get(saved)) saveComplete({ closeWhenFinished: true })
    else save(true)
}

export async function closeApp() {
    try {
        const timeout = <T>(promise: Promise<T>, ms: number): Promise<T | void> => {
            return Promise.race([promise, new Promise<void>((resolve) => setTimeout(resolve, ms))])
        }

        await timeout(stopAllInteractions(), 500)
        await timeout(stopRemoteController(), 500)
        autoDisableRemoteController()

        await timeout(stopMediaRecorder(), 3000)
        await timeout(stopAllChannelRecordings(), 3000)
    } catch (e) {
        console.error("Could not stop interactions before closing!", e)
    }

    sendMain(Main.CLOSE)
}

// GET SAVED STATE

export function unsavedUpdater() {
    if (unsavedTracking) return
    unsavedTracking = true
    const cachedValues: { [key: string]: string } = {}
    const s = { ...saveList, folders, projects, showsCache, stageShows, deletedShows, renamedShows }

    let initialized = false
    Object.keys(s).forEach((id) => {
        if (!s[id]) return

        s[id].subscribe((a: any) => {
            if (customSavedListener[id] && a) {
                a = customSavedListener[id](clone(a))
                let stringObj
                try {
                    stringObj = JSON.stringify(a)
                } catch {
                    return
                }
                if (cachedValues[id] === stringObj) return

                cachedValues[id] = stringObj
            }

            if (!initialized) return

            saveRevision++
            saved.set(false)
            if (id === "deletedShows" || id === "renamedShows") {
                setTimeout(() => saved.set(false))
            }
        })

        // set cached custom listener on load
        let store = get(s[id])
        if (customSavedListener[id] && store) {
            store = customSavedListener[id](clone(store))
            try {
                cachedValues[id] = JSON.stringify(store)
            } catch (e) {
                console.debug("Could not cache custom listener value for:", id, e)
            }
        }
    })

    initialized = true
}

const customSavedListener = {
    showsCache: (data: Shows) => {
        if (!data) return data
        Object.keys(data).forEach((id) => {
            if (!data[id]?.slides) return

            delete (data[id] as any).timestamps
            delete (data[id] as any).settings

            Object.values(data[id].slides).forEach((slide) => {
                if (!slide) return
                delete slide.id
            })
        })

        return data
    },
    projects: (data: Projects) => {
        if (!data) return data
        removeDeleted(keysToID(data)).forEach((a) => {
            data[a.id].shows?.map((show) => {
                delete show.layout
            })
        })

        return data
    }
}

const saveList: { [key in SaveList]: any } = {
    initialized: null,
    activeProject: null,
    alertUpdates,
    audioFolders,
    autoOutput,
    categories,
    autosave,
    timeFormat,
    maxConnections,
    ports,
    disabledServers,
    serverData,
    events,
    lockedOverlays: null,
    activeScenes: null,
    drawer: null,
    drawerTabsData: null,
    drawSettings,
    groupNumbers,
    fullColors,
    formatNewShow,
    groups,
    labelsDisabled,
    language,
    customFonts: null,
    mediaFolders,
    mediaOptions,
    openedFolders: null,
    outLocked: null,
    outputs: null,
    sorted: null,
    styles,
    profiles,
    overlayCategories,
    overlays,
    playerVideos,
    resized: null,
    scriptures,
    scriptureSettings,
    slidesOptions,
    splitLines,
    templateCategories,
    templates,
    scenes,
    timers,
    variables,
    interactions,
    audioStreams,
    audioPlaylists,
    theme,
    themes,
    transitionData,
    audioChannelsData,
    midiIn: actions,
    emitters,
    videoMarkers,
    calendars: null,
    mediaTags,
    playerTags,
    actionTags,
    variableTags,
    timerTags,
    customizedIcons,
    driveKeys,
    cloudSyncData,
    driveData,
    calendarAddShow: null,
    metronome: null,
    audioEffects: null,
    audioEffectPresets: null,
    effectsLibrary: null,
    special,
    timeline: null,
    timecode: null,
    globalTags,
    globalRegexes: null,
    customMetadata: null,
    contentProviderData,
    obsData: null,
    effects,
    audioRouting,
    deletedDefaults: null,
    syncedOutputs,
    ai: ai
}
