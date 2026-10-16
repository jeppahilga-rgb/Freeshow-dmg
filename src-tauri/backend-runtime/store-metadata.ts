import {defaultSettings,defaultSyncedSettings} from "../../src/electron/data/defaults"
const clone=structuredClone
export const storeFilesData={
    SHOWS: { fileName: "shows", portable: false, defaults: {} as TrimmedShows, minify: true }, // cache
    SETTINGS: { fileName: "settings", portable: false, defaults: clone(defaultSettings) },

    // PORTABLE
    SYNCED_SETTINGS: { fileName: "settings_synced", portable: true, defaults: clone(defaultSyncedSettings) },
    THEMES: { fileName: "themes", portable: true, defaults: {} as { [key: string]: Themes } },
    PROJECTS: { fileName: "projects", portable: true, defaults: { projects: {}, folders: {}, projectTemplates: {} } },
    STAGE: { fileName: "stage", portable: true, defaults: {} as StageLayouts },
    OVERLAYS: { fileName: "overlays", portable: true, defaults: {} as Overlays },
    TEMPLATES: { fileName: "templates", portable: true, defaults: {} as Templates },
    EVENTS: { fileName: "events", portable: true, defaults: {} as { [key: string]: Event } },

    HISTORY: { fileName: "history", portable: false, defaults: {} as { undo: History[]; redo: History[] }, minify: true },
    MEDIA: { fileName: "media", portable: false, defaults: {} as Media, minify: true },

    CACHE: { fileName: "cache", portable: false, defaults: {} as any, minify: true },
    CACHE_SYNC: { fileName: "cache_sync", portable: false, defaults: {} as any, minify: true },
    USAGE: { fileName: "usage", portable: false, defaults: {} as { all: any[] }, minify: true },
    ERROR_LOG: { fileName: "error_log", portable: false, defaults: {} as { renderer?: ErrorLog[]; main?: ErrorLog[]; request?: ErrorLog[] } },

    DRIVE_API_KEY: { fileName: "DRIVE_API_KEY", portable: false, defaults: {} as any },
    ACCESS: { fileName: "ACCESS", portable: false, defaults: { contentProviders: {} as { [key in ContentProviderId]?: any }, secrets: {} as { [key: string]: any } } }
}
