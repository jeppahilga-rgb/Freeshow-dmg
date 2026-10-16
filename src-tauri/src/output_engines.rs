use serde_json::{json,Value};
use std::{collections::HashMap,io::Write,net::{TcpStream,SocketAddr},sync::{Mutex,Arc,atomic::{AtomicU64,Ordering}},time::{Duration,Instant}};
use tauri::Manager;
use windows_capture::{capture::{CaptureControl,Context,GraphicsCaptureApiHandler},frame::Frame,graphics_capture_api::InternalCaptureControl,settings::*};
type Error=Box<dyn std::error::Error+Send+Sync>;
#[derive(Clone)]struct Flags{port:u16,auth:Vec<u8>,fps:Arc<AtomicU64>}
struct Handler{flags:Flags,connection:Option<TcpStream>,last:Instant,padding:Vec<u8>}
impl GraphicsCaptureApiHandler for Handler{
 type Flags=Flags;type Error=Error;
 fn new(ctx:Context<Flags>)->Result<Self,Error>{Ok(Self{flags:ctx.flags,connection:None,last:Instant::now()-Duration::from_secs(1),padding:Vec::new()})}
 fn on_frame_arrived(&mut self,frame:&mut Frame,_:InternalCaptureControl)->Result<(),Error>{
  if self.last.elapsed()<Duration::from_micros(1_000_000/self.flags.fps.load(Ordering::Relaxed).clamp(1,60)){return Ok(())}self.last=Instant::now();let width=frame.width();let height=frame.height();if width==0||height==0||width as u64*height as u64>4096*2160{return Ok(())}
  if self.connection.is_none(){if let Ok(mut stream)=TcpStream::connect_timeout(&SocketAddr::from(([127,0,0,1],self.flags.port)),Duration::from_millis(50)){let _=stream.set_nodelay(true);let _=stream.set_write_timeout(Some(Duration::from_millis(50)));if stream.write_all(&(self.flags.auth.len() as u32).to_le_bytes()).and_then(|_|stream.write_all(&self.flags.auth)).is_ok(){self.connection=Some(stream)}}}
  let Some(stream)=self.connection.as_mut()else{return Ok(())};let pixels=frame.buffer()?;let pixels=pixels.as_nopadding_buffer(&mut self.padding);let length=8+pixels.len();let result=stream.write_all(&(length as u32).to_le_bytes()).and_then(|_|stream.write_all(&width.to_le_bytes())).and_then(|_|stream.write_all(&height.to_le_bytes())).and_then(|_|stream.write_all(pixels));if result.is_err(){self.connection=None}Ok(())
 }
}
struct Session{control:Option<CaptureControl<Handler,Error>>,fps:Arc<AtomicU64>}
impl Drop for Session{fn drop(&mut self){if let Some(control)=self.control.take(){let _=control.stop();}}}
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
 let window=app.get_window(&format!("output-{id}")).ok_or("Output window is closed")?;let handle=window.hwnd().map_err(|e|e.to_string())?.0 as usize;
 let data=app.state::<crate::backend_runtime::BackendRuntime>().request(app,&app.state::<crate::Library>(),"OUTPUT_ENGINE".into(),json!({"output":output,"active":true})).await?;
 if let (Some(width),Some(height))=(data["captureWidth"].as_u64(),data["captureHeight"].as_u64()){if width==0||height==0||width>4096||height>2160{return Err("Unsupported hardware capture dimensions".into())}let size=window.inner_size().map_err(|e|e.to_string())?;if size.width!=width as u32||size.height!=height as u32{window.set_size(tauri::PhysicalSize::new(width as u32,height as u32)).map_err(|e|e.to_string())?;}}
 let port=data["port"].as_u64().filter(|p|*p>0&&*p<65536).ok_or("Invalid engine port")? as u16;let auth=serde_json::to_vec(&json!({"token":data["token"],"id":id})).map_err(|e|e.to_string())?;let fps=Arc::new(AtomicU64::new(data["initialFps"].as_u64().unwrap_or(1).clamp(1,60)));let flags=Flags{port,auth,fps:fps.clone()};
 let control=tauri::async_runtime::spawn_blocking(move||Handler::start_free_threaded(Settings::new(windows_capture::window::Window::from_raw_hwnd(handle as *mut _),CursorCaptureSettings::WithoutCursor,DrawBorderSettings::Default,SecondaryWindowSettings::Default,MinimumUpdateIntervalSettings::Default,DirtyRegionSettings::Default,ColorFormat::Bgra8,flags)).map_err(|e|e.to_string())).await.map_err(|e|e.to_string())??;
 app.state::<OutputEngines>().sessions.lock().unwrap().insert(id.clone(),Session{control:Some(control),fps});let rate=app.state::<crate::backend_runtime::BackendRuntime>().request(app,&app.state::<crate::Library>(),"ENGINE_RATE".into(),json!({"id":id})).await?;app.state::<OutputEngines>().set_rate(&id,rate.as_f64().unwrap_or(30.0).round() as u64);Ok(())
}
