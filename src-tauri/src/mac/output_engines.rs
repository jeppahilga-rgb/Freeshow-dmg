use serde_json::{json,Value};
use std::{collections::HashMap,io::Write,net::{TcpStream,SocketAddr},sync::{Mutex,Arc,atomic::{AtomicU64,Ordering}},time::{Duration,Instant}};
use tauri::Manager;
struct Session{_process:crate::native_capture::Process,fps:Arc<AtomicU64>}
#[derive(Default)]pub struct OutputEngines{sessions:Mutex<HashMap<String,Session>>,configs:Mutex<HashMap<String,Value>>,configuration_locks:Mutex<HashMap<String,Arc<tokio::sync::Mutex<()>>>>}
impl OutputEngines{
 pub fn stop(&self,id:&str){self.sessions.lock().unwrap().remove(id);}
 pub fn stop_all(&self){self.sessions.lock().unwrap().clear();self.configs.lock().unwrap().clear();}
 pub fn output(&self,id:&str)->Option<Value>{self.configs.lock().unwrap().get(id).cloned()}
 pub fn is_capturing(&self,id:&str)->bool{self.sessions.lock().unwrap().contains_key(id)}
 pub fn set_rate(&self,id:&str,fps:u64){if let Some(session)=self.sessions.lock().unwrap().get(id){session.fps.store(fps.clamp(1,60),Ordering::Relaxed)}}
 pub fn all_outputs(&self)->Vec<Value>{self.configs.lock().unwrap().values().cloned().collect()}
}
pub async fn configure(app:&tauri::AppHandle,output:&Value,active:bool)->Result<(),String>{
 let id=output["id"].as_str().ok_or("Missing output ID")?;
 if id.is_empty()||id.len()>128{return Err("Invalid output ID".into())}
 let lock={app.state::<OutputEngines>().configuration_locks.lock().unwrap().entry(id.to_string()).or_insert_with(||Arc::new(tokio::sync::Mutex::new(()))).clone()};let _guard=lock.lock().await;
 let result=configure_inner(app,output,active).await;
 if result.is_err(){if let Some(id)=output["id"].as_str(){app.state::<OutputEngines>().stop(id);app.state::<OutputEngines>().configs.lock().unwrap().remove(id);if app.state::<crate::backend_runtime::BackendRuntime>().is_started(){let _=app.state::<crate::backend_runtime::BackendRuntime>().request(app,&app.state::<crate::Library>(),"OUTPUT_ENGINE".into(),json!({"id":id,"active":false})).await;}}}
 result
}
async fn configure_inner(app:&tauri::AppHandle,output:&Value,active:bool)->Result<(),String>{
 let id=output["id"].as_str().ok_or("Missing output ID")?.to_string();app.state::<OutputEngines>().stop(&id);
 if active{app.state::<OutputEngines>().configs.lock().unwrap().insert(id.clone(),output.clone());}else{app.state::<OutputEngines>().configs.lock().unwrap().remove(&id);}
 let enabled=active&&(["ndi","omt","blackmagic"].iter().any(|key|output[*key].as_bool()==Some(true))||output["rtmp"].as_bool()==Some(true)&&output["rtmpData"]["streaming"].as_bool()==Some(true)||output["webrtc"].as_bool()==Some(true)&&output["webrtcData"]["streaming"].as_bool()==Some(true));
 if !enabled{if app.state::<crate::backend_runtime::BackendRuntime>().is_started(){app.state::<crate::backend_runtime::BackendRuntime>().request(app,&app.state::<crate::Library>(),"OUTPUT_ENGINE".into(),json!({"id":id,"active":false})).await?;}return Ok(())}
 let window=app.get_window(&format!("output-{id}")).ok_or("Output window is closed")?;let handle=crate::native_capture::window_handle(&window)?;
 let data=app.state::<crate::backend_runtime::BackendRuntime>().request(app,&app.state::<crate::Library>(),"OUTPUT_ENGINE".into(),json!({"output":output,"active":true})).await?;
 if let (Some(width),Some(height))=(data["captureWidth"].as_u64(),data["captureHeight"].as_u64()){if width==0||height==0||width>4096||height>2160{return Err("Unsupported hardware capture dimensions".into())}let size=window.inner_size().map_err(|e|e.to_string())?;if size.width!=width as u32||size.height!=height as u32{window.set_size(tauri::PhysicalSize::new(width as u32,height as u32)).map_err(|e|e.to_string())?;}}
 let port=data["port"].as_u64().filter(|p|*p>0&&*p<65536).ok_or("Invalid engine port")? as u16;let auth=serde_json::to_vec(&json!({"token":data["token"],"id":id})).map_err(|e|e.to_string())?;let fps=Arc::new(AtomicU64::new(data["initialFps"].as_u64().unwrap_or(1).clamp(1,60)));
 let rate=fps.clone();
 let process=tauri::async_runtime::spawn_blocking(move||{
  let mut connection:Option<TcpStream>=None;let mut last=Instant::now()-Duration::from_secs(1);
  crate::native_capture::stream(&format!("native-window-{handle}"),true,move|pixels|{
   if pixels.len()<8||last.elapsed()<Duration::from_micros(1_000_000/rate.load(Ordering::Relaxed).clamp(1,60)){return}last=Instant::now();
   let width=u32::from_le_bytes(pixels[..4].try_into().unwrap());let height=u32::from_le_bytes(pixels[4..8].try_into().unwrap());
   if width==0||height==0||width as u64*height as u64>4096*2160||pixels.len()!=8+width as usize*height as usize*4{return}
   if connection.is_none(){if let Ok(mut socket)=TcpStream::connect_timeout(&SocketAddr::from(([127,0,0,1],port)),Duration::from_millis(50)){
    let _=socket.set_nodelay(true);let _=socket.set_write_timeout(Some(Duration::from_millis(50)));
    if socket.write_all(&(auth.len() as u32).to_le_bytes()).and_then(|_|socket.write_all(&auth)).is_ok(){connection=Some(socket)}
   }}
   if let Some(socket)=connection.as_mut(){if socket.write_all(&(pixels.len() as u32).to_le_bytes()).and_then(|_|socket.write_all(&pixels)).is_err(){connection=None}}
  })
 }).await.map_err(|e|e.to_string())??;
 app.state::<OutputEngines>().sessions.lock().unwrap().insert(id.clone(),Session{_process:process,fps});let rate=app.state::<crate::backend_runtime::BackendRuntime>().request(app,&app.state::<crate::Library>(),"ENGINE_RATE".into(),json!({"id":id})).await?;app.state::<OutputEngines>().set_rate(&id,rate.as_f64().unwrap_or(30.0).round() as u64);Ok(())
}
