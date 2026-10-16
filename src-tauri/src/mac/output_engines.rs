use serde_json::Value;
use std::{collections::HashMap,sync::Mutex};
use tauri::Manager;
#[derive(Default)] pub struct OutputEngines{configs:Mutex<HashMap<String,Value>>}
impl OutputEngines {
 pub fn stop_all(&self){self.configs.lock().unwrap().clear()}
 pub fn output(&self,id:&str)->Option<Value>{self.configs.lock().unwrap().get(id).cloned()}
 pub fn all_outputs(&self)->Vec<Value>{self.configs.lock().unwrap().values().cloned().collect()}
 pub fn is_capturing(&self,_id:&str)->bool{false}
 pub fn set_rate(&self,_id:&str,_fps:u64){}
}
pub async fn configure(app:&tauri::AppHandle,output:&Value,active:bool)->Result<(),String>{
 let id=output["id"].as_str().ok_or("Missing output ID")?;
 if id.is_empty()||id.len()>128{return Err("Invalid output ID".into())}
 let state=app.state::<OutputEngines>();
 if !active{state.configs.lock().unwrap().remove(id);return Ok(())}
 if ["ndi","omt","blackmagic","rtmp","webrtc","virtualCamera"].iter().any(|key|output[*key].as_bool()==Some(true)){
  return Err("Native capture-based output engines are not available in this Mac core preview. Choose Window output.".into())
 }
 state.configs.lock().unwrap().insert(id.into(),output.clone());Ok(())
}
