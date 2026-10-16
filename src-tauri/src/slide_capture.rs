use serde_json::{json,Value};
use std::{collections::HashMap,sync::Mutex,time::Duration};
use tauri::{Manager,Emitter,State};
use base64::Engine;
pub struct SlideCapture{captures:Mutex<HashMap<String,Value>>,slots:tokio::sync::Semaphore}
impl Default for SlideCapture{fn default()->Self{Self{captures:Mutex::new(HashMap::new()),slots:tokio::sync::Semaphore::new(2)}}}
impl SlideCapture{pub fn output(&self,id:&str)->Option<Value>{self.captures.lock().unwrap().get(id).cloned()}}
struct Preview{app:tauri::AppHandle,id:String,window:tauri::Window}
impl Drop for Preview{fn drop(&mut self){self.app.state::<SlideCapture>().captures.lock().unwrap().remove(&self.id);let _=self.window.close();}}
#[tauri::command]
pub async fn capture_slide(app:tauri::AppHandle,caller:tauri::Webview,state:State<'_,SlideCapture>,data:Value)->Result<Value,String>{
 if caller.label()!="main"||caller.window().label()!="main"{return Err("Slide capture belongs to the editor".into());}
 let _slot=state.slots.acquire().await.map_err(|e|e.to_string())?;
 let width=data["resolution"]["width"].as_f64().unwrap_or(960.0).round().clamp(64.0,1920.0) as u32;let height=data["resolution"]["height"].as_f64().unwrap_or(540.0).round().clamp(64.0,1080.0) as u32;
 let mut output=data["output"].as_object().and_then(|map|map.values().next()).cloned().ok_or("Missing slide capture output")?;
 let id=format!("preview-{}",uuid::Uuid::new_v4());output["id"]=json!(id);output["invisible"]=json!(true);output["boundsLocked"]=json!(true);output["bounds"]=json!({"width":width,"height":height});
 state.captures.lock().unwrap().insert(id.clone(),json!({id.clone():output}));
 let output=state.output(&id).unwrap();let window=match crate::create_output(&app,&output[&id]){Ok(window)=>window,Err(error)=>{state.captures.lock().unwrap().remove(&id);return Err(error)}};
 let preview=Preview{app:app.clone(),id:id.clone(),window};crate::position_output(&preview.window,&output[&id],false,&app)?;preview.window.set_size(tauri::PhysicalSize::new(width,height)).map_err(|e|e.to_string())?;preview.window.show().map_err(|e|e.to_string())?;
 if let Some(view)=app.get_webview(preview.window.label()){crate::websites::set_audio(&view,true).await?;}
 // Outputs request their normal shared stores; retain this snapshot when OUTPUTS is broadcast.
 for _ in 0..8{tokio::time::sleep(Duration::from_millis(500)).await;preview.window.emit_to(preview.window.label(),"freeshow-ipc",json!({"channel":"OUTPUT","msg":{"channel":"OUTPUTS","data":output}})).map_err(|e|e.to_string())?;}
 let handle=preview.window.hwnd().map_err(|e|e.to_string())?.0 as usize;
 let bytes=tauri::async_runtime::spawn_blocking(move||crate::native_capture::window_jpeg(handle)).await.map_err(|e|e.to_string())??;
 Ok(json!({"base64":format!("data:image/jpeg;base64,{}",base64::engine::general_purpose::STANDARD.encode(bytes))}))
}
