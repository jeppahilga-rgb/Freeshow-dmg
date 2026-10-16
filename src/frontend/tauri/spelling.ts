import {invoke} from '@tauri-apps/api/core'
import {spellcheck,contextActive} from '../stores'
import {get} from 'svelte/store'
type Saved={word:string;language:string;range?:Range;input?:HTMLInputElement|HTMLTextAreaElement;start?:number;end?:number}
let saved:Saved|undefined,generation=0
export async function checkContextSpelling(event:MouseEvent){
 if(!(window as any).__TAURI_INTERNALS__)return
 const version=++generation;saved=undefined;const target=event.target as HTMLElement;if(!target.closest('input,textarea,[contenteditable="true"]'))return
 let text='',offset=0,range:Range|undefined,input:HTMLInputElement|HTMLTextAreaElement|undefined
 if(target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement){if(target instanceof HTMLInputElement&&!['text','search','email','url'].includes(target.type))return;input=target;text=input.value;offset=input.selectionStart??0}
 else{range=(document as any).caretRangeFromPoint?.(event.clientX,event.clientY);if(!range||range.startContainer.nodeType!==Node.TEXT_NODE)return;text=range.startContainer.textContent||'';offset=range.startOffset}
 const language=target.closest('[lang]')?.getAttribute('lang')||navigator.language||'en-US';const segmenter=new Intl.Segmenter(language,{granularity:'word'});const item=[...segmenter.segment(text)].find(item=>item.isWordLike&&item.index<=offset&&item.index+item.segment.length>=offset);if(!item||item.segment.length>256)return
 const selected={word:item.segment,language,input,start:item.index,end:item.index+item.segment.length,range:range?.cloneRange()};if(selected.range){selected.range.setStart(selected.range.startContainer,item.index);selected.range.setEnd(selected.range.startContainer,item.index+item.segment.length)}
 const result=await invoke<any>('desktop_service',{operation:'SPELLCHECK',data:{word:selected.word,language}}).catch(()=>null);if(version!==generation||!result?.misspelled||!get(contextActive))return;saved=selected;spellcheck.set({misspelled:selected.word,suggestions:result.suggestions||[]})
}
export async function correctSpelling(data:any){
 if(!saved)return
 if(data.addToDictionary){await invoke('desktop_service',{operation:'SPELLCHECK',data:{action:'add',word:saved.word,language:saved.language}});return}
 if(typeof data.fixSpelling!=='string')return
 const {range,input,start,end,word}=saved
 if(input&&input.value.slice(start,end)===word){input.focus();input.setRangeText(data.fixSpelling,start!,end!,'end');input.dispatchEvent(new Event('input',{bubbles:true}))}
 else if(range&&range.toString()===word&&range.startContainer.isConnected){const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);(range.startContainer.parentElement?.closest('[contenteditable]') as HTMLElement)?.focus();document.execCommand('insertText',false,data.fixSpelling)}
 saved=undefined
}
