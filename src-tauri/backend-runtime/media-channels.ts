import {ndiResponses} from '../../src/electron/ndi/talk'
import {omtResponses} from '../../src/electron/omt/talk'
import {BlackmagicManager} from '../../src/electron/blackmagic/BlackmagicManager'
import {BlackmagicReceiver} from '../../src/electron/blackmagic/BlackmagicReceiver'
const blackmagic={GET_DEVICES:()=>BlackmagicManager.getDevices(),RESET_DEVICE:(data:any)=>BlackmagicManager.resetDevice(data.deviceId),RECEIVE_FRAME:(data:any)=>BlackmagicReceiver.captureFrame(data),RECEIVE_STREAM:(data:any)=>BlackmagicReceiver.startCapture(data),STOP_RECEIVER:(data:any)=>BlackmagicReceiver.stopReceiver(data)}
export async function mediaChannel(data:any){const handlers:any=data.channel==='NDI'?ndiResponses:data.channel==='OMT'?omtResponses:data.channel==='BLACKMAGIC'?blackmagic:undefined;const handler=handlers?.[data.message?.channel];if(!handler)throw Error('Unknown media engine operation');return await handler(data.message.data)??null}
