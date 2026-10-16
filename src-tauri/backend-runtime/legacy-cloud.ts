import {cloudConnect} from '../../src/electron/cloud/cloud'
export async function legacyCloud(data:any){const message=data.message;if(!['DRIVE_CONNECT','GET_MAIN_FOLDER','SYNC_DATA'].includes(message?.channel))throw Error('Unknown Drive operation');let response:any=null;await cloudConnect({reply:(_channel:string,message:any)=>response=message} as any,message);return response}
