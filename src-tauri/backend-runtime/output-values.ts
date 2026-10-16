import {outputs} from './output-state'
export class OutputValues{static updateValue(data:any){const output=outputs.get(data.id);if(output)output[data.key]=data.value;return (globalThis as any).__fsNative('OUTPUT_VALUE',data)}}
