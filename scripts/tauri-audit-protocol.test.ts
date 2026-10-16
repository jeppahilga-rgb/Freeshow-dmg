import { beforeEach, expect, it, vi } from 'vitest'
const { invoke, importDocument } = vi.hoisted(() => ({ invoke: vi.fn(), importDocument: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'main' }) }))
vi.mock('../src/frontend/tauri/documentImport', () => ({ importDocument }))
vi.mock('../src/frontend/tauri/screenCapture', () => ({ installScreenCapture: vi.fn(async () => {}), screenSources: vi.fn() }))
vi.mock('../src/frontend/tauri/media', () => ({ mediaThumbnail: vi.fn() }))
vi.mock('../src/frontend/tauri/lyrics', () => ({ searchLyrics: vi.fn(), getLyrics: vi.fn() }))
vi.mock('../src/electron/data/defaults', () => ({ defaultSettings: {}, defaultSyncedSettings: {} }))
import { installTauriBridge } from '../src/frontend/tauri/bridge'

beforeEach(async () => {
    vi.restoreAllMocks(); invoke.mockReset(); importDocument.mockReset()
    vi.stubGlobal('window', {})
    vi.stubGlobal('document', { addEventListener: vi.fn(), getElementById: () => null, createElement: () => ({ style: {} }), body: { style: {}, append: vi.fn() } })
    await installTauriBridge()
})

// Regression coverage for issues identified by the audit.
it('routes explicit PowerPoint-to-PDF through document conversion', async () => {
    invoke.mockImplementation(async command => command === 'pick_media_files' ? { files: ['C:/Deck.pptx'] } : { xml: { 'ppt/presentation.xml': '<p:presentation/>' }, contentPaths: {} })
    const receive = vi.fn(); window.api.receive('MAIN', receive)
    window.api.send('MAIN', { channel: 'PPT_TO_PDF' })
    importDocument.mockResolvedValue({images:['C:/Imports/page-1.png'],name:'Deck'})
    await vi.waitFor(() => expect(importDocument).toHaveBeenCalledWith('C:/Deck.pptx',expect.any(Function)))
    expect(invoke).not.toHaveBeenCalledWith('import_powerpoint',expect.anything())
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({ channel: 'IMAGES_TO_SHOW' }), undefined)
})

it('notifies the renderer of save failure so it can retain changes and recover', async () => {
    invoke.mockRejectedValue(Error('Disk unavailable'))
    const warn=vi.spyOn(console,'warn').mockImplementation(()=>{})
    const receive=vi.fn(); window.api.receive('MAIN',receive)
    window.api.send('MAIN',{channel:'SAVE',data:{showsCache:{},closeWhenFinished:true}})
    await vi.waitFor(()=>expect(warn).toHaveBeenCalled())
    expect(receive).toHaveBeenCalledWith({channel:'SAVE_ERROR',data:{message:'Error: Disk unavailable'}},undefined)
    expect(receive).not.toHaveBeenCalledWith(expect.objectContaining({channel:'SAVE2'}),expect.anything())
})

it.each(['BACKUPS','RESTORE'])('routes %s to the implemented backup service', async channel => {
    invoke.mockResolvedValue(channel==='BACKUPS'?[]:null)
    const receive=vi.fn();window.api.receive('MAIN',receive)
    window.api.send('MAIN',{channel},'audit')
    await vi.waitFor(()=>expect(invoke).toHaveBeenCalledWith('backup_service',{operation:channel,path:null}))
    expect(receive).toHaveBeenCalledWith(channel==='BACKUPS'?{channel,data:[]}:{channel:'RESTORE2',data:{finished:false}},channel==='BACKUPS'?'audit':undefined)
})

it('reports backup completion only after native save returns a completed archive',async()=>{
    invoke.mockResolvedValue({backupPath:'C:/Library/Backups/complete.zip'})
    const receive=vi.fn();window.api.receive('MAIN',receive)
    window.api.send('MAIN',{channel:'SAVE',data:{customTriggers:{backup:true}}})
    await vi.waitFor(()=>expect(receive).toHaveBeenCalledWith({channel:'BACKUP',data:{finished:true,path:'C:/Library/Backups/complete.zip'}},undefined))
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({channel:'SAVE2'}),undefined)
})

it.each(['START_SLIDESHOW','MEDIA_DOWNLOAD','SEND_MIDI','TIMECODE_START','RECORDER'])('makes unsupported %s explicit instead of silently completing', async channel => {
    vi.spyOn(console,'warn').mockImplementation(()=>{})
    const receive=vi.fn(); window.api.receive('MAIN',receive)
    window.api.send('MAIN',{channel,data:{}},'audit')
    await vi.waitFor(()=>expect(receive).toHaveBeenCalledWith({channel,data:null},'audit'))
    expect(invoke).not.toHaveBeenCalled()
    expect(receive).toHaveBeenCalledWith({channel:'ALERT',data:`${channel} is not available in this Tauri build.`},undefined)
})
