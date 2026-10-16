const pending=new Map<string,{resolve:(v:any)=>void,timer:ReturnType<typeof setTimeout>}>()
export function sendToMain(channel:string,data:any,id?:string){(globalThis as any).__fsEvent('MAIN',{channel,data},id)}
export const sendMain=sendToMain
export async function requestToMain(channel:string,data:any,callback?:any,timeout=15000){const id='worker-reply-'+crypto.randomUUID();const result=await new Promise(resolve=>{const timer=setTimeout(()=>{pending.delete(id);resolve(null)},timeout);pending.set(id,{resolve,timer});sendToMain(channel,data,id)});callback?.(result);return result}
export function reply(id:string,msg:any){const item=pending.get(id);if(item){clearTimeout(item.timer);pending.delete(id);item.resolve(msg.data)}}
