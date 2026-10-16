import {Main} from "C:/Users/User/Documents/ChatGPT/Freeshow/upstream/src/types/IPC/Main"
import {ToMain} from "C:/Users/User/Documents/ChatGPT/Freeshow/upstream/src/types/IPC/ToMain"
import {completeLLM,fetchProviderModels} from "C:/Users/User/Documents/ChatGPT/Freeshow/upstream/src/electron/ai/llm/llmProviders"
import {setAiKey} from "C:/Users/User/Documents/ChatGPT/Freeshow/upstream/src/electron/ai/setup/aiKeys"
import {aiHandleLocalSetup,LocalModelManager} from "C:/Users/User/Documents/ChatGPT/Freeshow/upstream/src/electron/ai/setup/LocalModelManager"
import {aiGetModelStatus} from "C:/Users/User/Documents/ChatGPT/Freeshow/upstream/src/electron/ai/setup/status"
import {SpeechToText} from "C:/Users/User/Documents/ChatGPT/Freeshow/upstream/src/electron/ai/stt/SpeechToTextManager"
import {CaptureHelper} from "C:/Users/User/Documents/ChatGPT/Freeshow/upstream/src/electron/capture/CaptureHelper"
import {canSync,getSyncTeams,hasTeamData,markAsNewSync,restoreCloudBackup,syncData} from "C:/Users/User/Documents/ChatGPT/Freeshow/upstream/src/electron/cloud/syncManager"
import {ChurchAppsChat} from "C:/Users/User/Documents/ChatGPT/Freeshow/upstream/src/electron/contentProviders/churchApps/ChurchAppsChat"
import {ContentProviderRegistry} from "C:/Users/User/Documents/ChatGPT/Freeshow/upstream/src/electron/contentProviders/ContentProviderRegistry"
import {checkIfMediaDownloaded,downloadLessonsMedia,downloadMedia} from "C:/Users/User/Documents/ChatGPT/Freeshow/upstream/src/electron/data/downloadMedia"
import {getStoreValue,setStoreValue} from "C:/Users/User/Documents/ChatGPT/Freeshow/upstream/src/electron/data/store"
import {getPresentationApplications,presentationControl,startSlideshow} from "C:/Users/User/Documents/ChatGPT/Freeshow/upstream/src/electron/output/ppt/presentation"
import {detectEncoders,setRtmpEncoderSetting} from "C:/Users/User/Documents/ChatGPT/Freeshow/upstream/src/electron/streaming/encoderDetection"
import {downloadFfmpeg} from "C:/Users/User/Documents/ChatGPT/Freeshow/upstream/src/electron/streaming/ffmpegManager"
import {processAudioData,timecodeStart,timecodeStop,updateTimecodeValue} from "C:/Users/User/Documents/ChatGPT/Freeshow/upstream/src/electron/timecode/timecode"
import {bundleMediaFiles,getSimularPaths,readExifData} from "C:/Users/User/Documents/ChatGPT/Freeshow/upstream/src/electron/utils/files"
import {getMachineId} from "C:/Users/User/Documents/ChatGPT/Freeshow/upstream/src/electron/utils/helpers"
import {sendToMain} from "C:/Users/User/Documents/ChatGPT/Freeshow/upstream/src/electron/IPC/main"
async function getConversationId(teamId: string): Promise<string | null> {
    return ChurchAppsChat.getOrCreateConversation(teamId)
}
async function sendSocketMessage(data: { churchId: string; teamId: string; displayName: string; content: string }): Promise<boolean> {
    const conversationId = await ChurchAppsChat.getOrCreateConversation(data.teamId)
    if (!conversationId) return false
    return ChurchAppsChat.sendMessage({ churchId: data.churchId, conversationId, displayName: data.displayName, content: data.content })
}
export const handlers = {
[Main.DEVICE_ID]: () => getMachineId(),
[Main.GET_STORE_VALUE]: (data) => getStoreValue(data),
[Main.SET_STORE_VALUE]: (data) => setStoreValue(data),
[Main.READ_EXIF]: (data) => readExifData(data),
[Main.DOWNLOAD_LESSONS_MEDIA]: (data) => downloadLessonsMedia(data),
[Main.MEDIA_DOWNLOAD]: (data) => downloadMedia(data),
[Main.MEDIA_IS_DOWNLOADED]: async (data) => await checkIfMediaDownloaded(data),
[Main.SLIDESHOW_GET_APPS]: () => getPresentationApplications(),
[Main.START_SLIDESHOW]: (data) => startSlideshow(data),
[Main.PRESENTATION_CONTROL]: (data) => presentationControl(data),
[Main.GET_SIMILAR]: (data) => getSimularPaths(data),
[Main.BUNDLE_MEDIA_FILES]: (data) => bundleMediaFiles(data),
[Main.CAN_SYNC]: (data) => canSync(data),
[Main.GET_TEAMS]: (data) => getSyncTeams(data),
[Main.CLOUD_DATA]: (data) => hasTeamData(data),
[Main.CLOUD_SYNC]: (data) => syncData(data),
[Main.RESTORE_CLOUD_BACKUP]: (data) => restoreCloudBackup(data),
[Main.GET_CONVERSATION_ID]: (data) => getConversationId(data.teamId),
[Main.SEND_SOCKET_MESSAGE]: (data) => sendSocketMessage(data),
[Main.PROVIDER_LOAD_SERVICES]: async (data) => {
        if (data.cloudOnly) markAsNewSync()
        await ContentProviderRegistry.loadServices(data.providerId, data.cloudOnly || false, data.data)
    },
[Main.PROVIDER_CONNECTIONS]: () => ContentProviderRegistry.getConnectedProviders(),
[Main.PROVIDER_DISCONNECT]: (data) => {
        ContentProviderRegistry.disconnect(data.providerId, data.scope)
        return { success: true }
    },
[Main.PROVIDER_STARTUP_LOAD]: (data) => ContentProviderRegistry.startupLoad(data.providerId, data.scope || "", data.data, data.cloudOnly),
[Main.PROVIDER_FETCH_FOLDERS]: (data) => ContentProviderRegistry.fetchFolderTree(data.providerId),
[Main.PCO_FETCH_SERVICE_TREE]: () => ContentProviderRegistry.fetchServiceTree("planningcenter"),
[Main.PCO_LOAD_PLAN]: (data) => ContentProviderRegistry.loadSinglePlan(data.serviceTypeId, data.planId),
[Main.PCO_LIVE_GET]: (data) => ContentProviderRegistry.getPcoLiveData(data.serviceTypeId, data.planId).catch(() => null),
[Main.PCO_PUSHER_AUTH]: (data) => ContentProviderRegistry.getPcoPusherAuth(data.socketId, data.channelName, data.serviceTypeId),
[Main.ONSTAGE_GET_TEAMS]: () => ContentProviderRegistry.getOnStageTeams().catch(() => []),
[Main.ONSTAGE_SWITCH_TEAM]: (data) => ContentProviderRegistry.switchOnStageTeam(data.teamId).catch(() => ({ success: false })),
[Main.ONSTAGE_LOAD_SERVICE]: (data) => ContentProviderRegistry.loadOnStageService(data.serviceId, data.data),
[Main.GET_CONTENT_PROVIDERS]: () => {
        const providers = ContentProviderRegistry.getAvailableProviders()
        return providers.map((providerId) => {
            const provider = ContentProviderRegistry.getProvider(providerId)
            return {
                providerId,
                displayName: provider?.displayName || providerId,
                hasContentLibrary: provider?.hasContentLibrary || false
            }
        })
    },
[Main.GET_CONTENT_LIBRARY]: async (data) => {
        const provider = ContentProviderRegistry.getProvider(data.providerId)
        if (!provider?.getContentLibrary) {
            console.error(`Provider ${data.providerId} does not support content library`)
            return []
        }
        return await provider.getContentLibrary()
    },
[Main.GET_PROVIDER_CONTENT]: async (data) => {
        const provider = ContentProviderRegistry.getProvider(data.providerId)
        if (!provider?.getContent) {
            console.error(`Provider ${data.providerId} does not support getContent`)
            return []
        }
        return await provider.getContent(data.key)
    },
[Main.CHECK_MEDIA_LICENSE]: async (data) => {
        const provider = ContentProviderRegistry.getProvider(data.providerId)
        if (!provider?.checkMediaLicense) {
            console.error(`Provider ${data.providerId} does not support checkMediaLicense`)
            return null
        }
        return await provider.checkMediaLicense(data.mediaId)
    },
[Main.TIMECODE_START]: (data) => timecodeStart(data),
[Main.TIMECODE_STOP]: () => timecodeStop(),
[Main.TIMECODE_VALUE]: (data) => updateTimecodeValue(data),
[Main.TIMECODE_STATUS]: (data) => console.log(data),
[Main.TIMECODE_AUDIO_DATA]: (data) => processAudioData(data),
[Main.ENCODER_DETECT]: (data) => detectEncoders(data?.force),
[Main.SET_RTMP_ENCODER]: (data) => {
        setRtmpEncoderSetting(data.outputId, data.encoder)
        // apply now rather than lying dormant until some unrelated capture event restarts the encode
        CaptureHelper.Lifecycle.updateRtmpState()
    },
[Main.FFMPEG_DOWNLOAD]: async () => {
        try {
            await downloadFfmpeg((progress) => {
                sendToMain(ToMain.MEDIA_DOWNLOAD_PROGRESS, { url: "ffmpeg", name: "FFmpeg", progress, total: 100, status: "downloading" })
            })
            sendToMain(ToMain.MEDIA_DOWNLOAD_PROGRESS, { url: "ffmpeg", name: "FFmpeg", progress: 100, total: 100, status: "complete" })
            return { success: true }
        } catch (error: any) {
            console.error("FFmpeg download error:", error)
            sendToMain(ToMain.MEDIA_DOWNLOAD_PROGRESS, { url: "ffmpeg", name: "FFmpeg", progress: 0, total: 0, status: "error" })
            return { success: false, error: error?.message || "Unknown download error" }
        }
    },
[Main.AI_GET_MODELS]: (data) => fetchProviderModels(data.providerId),
[Main.AI_GET_BIN]: () => LocalModelManager.getDownloadedBinFiles(),
[Main.AI_LISTEN_START]: (data) => SpeechToText.listen(data.engine, data.engineOptions),
[Main.AI_LISTEN_STOP]: () => SpeechToText.stop(),
[Main.AI_AUDIO_DATA]: (data) => SpeechToText.pushAudio(data.buffer),
[Main.AI_GET_STATUS]: (data) => aiGetModelStatus(data),
[Main.AI_SETUP]: (data) => aiHandleLocalSetup(data),
[Main.AI_SET_KEY]: (data) => setAiKey(data),
[Main.AI_LLM_COMPLETE]: (data) => completeLLM(data)
}
