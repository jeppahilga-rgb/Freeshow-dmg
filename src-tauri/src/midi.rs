use serde_json::{json,Value};
use std::{collections::HashMap,sync::Mutex};
use tauri::{Emitter,State};
use windows::Win32::Media::{Audio::*,MM_MIM_DATA};
struct Context {app:tauri::AppHandle,id:String}
struct Input {handle:usize,context:usize}
impl Drop for Input {fn drop(&mut self){unsafe{let h=HMIDIIN(self.handle as *mut _);midiInStop(h);midiInReset(h);if midiInClose(h)==0{drop(Box::from_raw(self.context as *mut Context));}}}}
#[derive(Default)] pub struct Midi {inputs:Mutex<HashMap<String,Input>>,outputs:Mutex<HashMap<String,usize>>}
impl Midi {pub fn stop(&self){self.inputs.lock().unwrap().clear();let mut outputs=self.outputs.lock().unwrap();for handle in outputs.values(){unsafe{let h=HMIDIOUT(*handle as *mut _);midiOutReset(h);midiOutClose(h);}}outputs.clear();}}
impl Drop for Midi{fn drop(&mut self){self.stop();}}
fn name(chars:&[u16])->String{String::from_utf16_lossy(&chars[..chars.iter().position(|c|*c==0).unwrap_or(chars.len())])}
fn devices(input:bool)->Vec<(u32,String)>{unsafe{let count=if input{midiInGetNumDevs()}else{midiOutGetNumDevs()};(0..count).filter_map(|i|{if input{let mut caps=MIDIINCAPSW::default();(midiInGetDevCapsW(i as usize,&mut caps,std::mem::size_of_val(&caps) as u32)==0).then(||{let chars=caps.szPname;(i,name(&chars))})}else{let mut caps=MIDIOUTCAPSW::default();(midiOutGetDevCapsW(i as usize,&mut caps,std::mem::size_of_val(&caps) as u32)==0).then(||{let chars=caps.szPname;(i,name(&chars))})}}).collect()}}
fn check(code:u32)->Result<(),String>{if code==0{Ok(())}else{Err(format!("Windows MIDI error {code}"))}}
use crate::midi_protocol::{message,decode};
unsafe extern "system" fn callback(_:HMIDIIN,event:u32,instance:usize,param:usize,_:usize){if event!=MM_MIM_DATA||instance==0{return;}let ctx=unsafe{&*(instance as *const Context)};if let Some(data)=decode(&ctx.id,param as u32){let _=ctx.app.emit_to("main","freeshow-ipc",json!({"channel":"MAIN","msg":{"channel":"RECEIVE_MIDI2","data":data}}));}}
#[tauri::command]
pub fn midi_service(app:tauri::AppHandle,caller:tauri::Webview,state:State<'_,Midi>,operation:String,data:Value)->Result<Value,String>{
    if caller.label()!="main"||caller.label()!=caller.window().label(){return Err("MIDI belongs to the editor".into());}
    match operation.as_str(){
        "GET_MIDI_INPUTS"|"GET_MIDI_OUTPUTS"=>Ok(json!(devices(operation=="GET_MIDI_INPUTS").into_iter().map(|(_,name)|json!({"name":name})).collect::<Vec<_>>())),
        "SEND_MIDI"=>{let target=data["output"].as_str().ok_or("Select a MIDI output")?;let index=devices(false).into_iter().find(|(_,n)|n==target).map(|(id,_)|id).ok_or("MIDI output not found")?;let packed=message(data["type"].as_str().unwrap_or("noteon"),&data["values"])?;let mut ports=state.outputs.lock().unwrap();let handle=if let Some(h)=ports.get(target){*h}else{let mut handle=HMIDIOUT::default();unsafe{check(midiOutOpen(&mut handle,index as u32,None,None,MIDI_WAVE_OPEN_TYPE(0)))?;}ports.insert(target.to_owned(),handle.0 as usize);handle.0 as usize};unsafe{check(midiOutShortMsg(HMIDIOUT(handle as *mut _),packed))?;}Ok(Value::Null)},
        "RECEIVE_MIDI"=>{let id=data["id"].as_str().ok_or("Missing MIDI listener ID")?;let target=data["input"].as_str().ok_or("Select a MIDI input")?;let index=devices(true).into_iter().find(|(_,n)|n==target).map(|(id,_)|id).ok_or("MIDI input not found")?;let mut ports=state.inputs.lock().unwrap();if ports.contains_key(id){return Ok(Value::Null);}let context=Box::into_raw(Box::new(Context{app,id:id.into()}));let mut handle=HMIDIIN::default();let code=unsafe{midiInOpen(&mut handle,index as u32,Some(callback as *const () as usize),Some(context as usize),CALLBACK_FUNCTION)};if code!=0{unsafe{drop(Box::from_raw(context));}check(code)?;}let input=Input{handle:handle.0 as usize,context:context as usize};unsafe{check(midiInStart(handle))?;}ports.insert(id.into(),input);Ok(Value::Null)},
        "CLOSE_MIDI"=>{let id=data["id"].as_str().unwrap_or("");if id.is_empty(){state.stop();}else{state.inputs.lock().unwrap().remove(id);}Ok(Value::Null)},
        _=>Err("Unknown MIDI operation".into())
    }
}
