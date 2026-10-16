use std::{collections::{HashMap,HashSet},io::Read,path::PathBuf,process::{Child,Command,Stdio},sync::{Arc,Mutex},time::Duration};
use tauri::{Window,State,Manager,ipc::Response};
#[derive(Default)]struct Latest{jpeg:Vec<u8>,closed:bool}
pub struct Process{child:Child}
impl Drop for Process{fn drop(&mut self){let _=self.child.kill();let _=self.child.wait();}}
pub fn helper()->Result<PathBuf,String>{
 let exe=std::env::current_exe().map_err(|e|e.to_string())?;
 let bundled=exe.parent().ok_or("Application path missing")?.join("../Resources/runtime/freeshow-native");
 if bundled.is_file(){return Ok(bundled)}
 let development=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("mac-runtime/freeshow-native");
 if development.is_file(){return Ok(development)}Err("The native Mac capture helper is missing. Reinstall FreeShow+.".into())
}
fn source(id:&str)->Result<(),String>{
 if ["native-window-","native-screen-"].iter().any(|prefix|id.strip_prefix(prefix).is_some_and(|n|!n.is_empty()&&n.parse::<u32>().is_ok())){Ok(())}else{Err("Invalid capture source".into())}
}
pub fn stream(id:&str,raw:bool,mut frame:impl FnMut(Vec<u8>)+Send+'static)->Result<Process,String>{
 source(id)?;
 let mut child=Command::new(helper()?).args([if raw{"raw"}else{"jpeg"},id]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e|e.to_string())?;
 let mut stdout=child.stdout.take().ok_or("Capture pipe unavailable")?;
 std::thread::spawn(move||{loop{let mut size=[0;4];if stdout.read_exact(&mut size).is_err(){break}let size=u32::from_le_bytes(size) as usize;if size==0||size>8192*8192*4+8{break}let mut bytes=vec![0;size];if stdout.read_exact(&mut bytes).is_err(){break}frame(bytes)}frame(Vec::new());});
 Ok(Process{child})
}
struct Session{latest:Arc<Mutex<Latest>>,_process:Process,consumers:HashSet<String>}
#[derive(Default,Clone)]pub struct NativeCapture(Arc<Mutex<HashMap<String,Session>>>);
impl NativeCapture{
 fn start(&self,id:&str,owner:String)->Result<(),String>{
  let mut sessions=self.0.lock().map_err(|_|"Capture state unavailable")?;
  if let Some(session)=sessions.get_mut(id){session.consumers.insert(owner);return Ok(())}
  let latest=Arc::new(Mutex::new(Latest::default()));let target=latest.clone();
  let process=stream(id,false,move|bytes|{if let Ok(mut state)=target.lock(){if bytes.is_empty(){state.closed=true}else{state.jpeg=bytes}}})?;
  sessions.insert(id.into(),Session{latest,_process:process,consumers:HashSet::from([owner])});Ok(())
 }
 fn frame(&self,id:&str,owner:&str)->Result<Vec<u8>,String>{
  let sessions=self.0.lock().map_err(|_|"Capture state unavailable")?;
  let session=sessions.get(id).ok_or("Capture ended")?;
  if !session.consumers.contains(owner){return Err("Capture subscription expired".into())}
  let frame=session.latest.lock().map_err(|_|"Capture frame unavailable")?;
  if frame.closed{return Err("Capture stopped. Allow FreeShow+ in System Settings → Privacy & Security → Screen Recording, then reopen the app.".into())}
  Ok(frame.jpeg.clone())
 }
 fn release(&self,id:Option<&str>,owner:&str,prefix:bool){
  let mut sessions=self.0.lock().unwrap();
  for (key,session) in sessions.iter_mut(){if id.is_none_or(|id|id==key){session.consumers.retain(|value|if prefix{!value.starts_with(owner)}else{value!=owner});}}
  sessions.retain(|_,session|!session.consumers.is_empty());
 }
 pub fn close_window(&self,label:&str){self.release(None,&format!("{label}:"),true)}
 pub fn server_frame(&self,window:Window,owner:String)->Result<Vec<u8>,String>{let id=format!("native-window-{}",window_handle(&window)?);self.start(&id,owner.clone())?;self.frame(&id,&owner)}
}
pub fn window_handle(window:&Window)->Result<usize,String>{
 use objc2::msg_send;use objc2_app_kit::NSWindow;
 let pointer=window.ns_window().map_err(|e|e.to_string())? as *mut NSWindow;
 // NSWindow access must run on AppKit's main thread.
 let (sender,receiver)=std::sync::mpsc::sync_channel(1);let address=pointer as usize;
 window.run_on_main_thread(move||{let value:isize=unsafe{msg_send![address as *mut NSWindow,windowNumber]};let _=sender.send(value);}).map_err(|e|e.to_string())?;
 let value=receiver.recv_timeout(Duration::from_secs(5)).map_err(|_|"Window ID unavailable")?;
 if value<=0{return Err("Window is not ready for capture".into())}Ok(value as usize)
}
pub fn window_jpeg(handle:usize)->Result<Vec<u8>,String>{
 let latest=Arc::new(Mutex::new(Vec::new()));let target=latest.clone();let _process=stream(&format!("native-window-{handle}"),false,move|bytes|{if !bytes.is_empty(){*target.lock().unwrap()=bytes}})?;
 for _ in 0..150{let frame=latest.lock().unwrap().clone();if !frame.is_empty(){return Ok(frame)}std::thread::sleep(Duration::from_millis(50));}Err("No capture frame. Check macOS Screen Recording permission.".into())
}
#[tauri::command]pub async fn native_sources(window:Window)->Result<Vec<serde_json::Value>,String>{
 if window.label()!="main"{return Err("Choose sources in the editor".into())}
 tauri::async_runtime::spawn_blocking(||{let output=Command::new(helper()?).arg("sources").output().map_err(|e|e.to_string())?;if !output.status.success(){return Err("Allow FreeShow+ in macOS Screen Recording settings, then reopen the app.".into())}serde_json::from_slice(&output.stdout).map_err(|e|e.to_string())}).await.map_err(|e|e.to_string())?
}
#[tauri::command]pub fn native_capture_browser(url:String,window:Window)->Result<(),String>{
 if window.label()!="main"{return Err("Editor only".into())}let parsed=reqwest::Url::parse(&url).map_err(|e|e.to_string())?;
 if !["http","https"].contains(&parsed.scheme())||parsed.host_str().is_none()||!parsed.username().is_empty()||parsed.password().is_some(){return Err("HTTP(S) URL without credentials required".into())}crate::platform::open_target(url,true)
}
#[tauri::command]pub async fn native_thumbnail(id:String,window:Window)->Result<Response,String>{
 if window.label()!="main"{return Err("Choose sources in the editor".into())}source(&id)?;
 tauri::async_runtime::spawn_blocking(move||{let manager=NativeCapture::default();manager.start(&id,"thumbnail".into())?;for _ in 0..100{let frame=manager.frame(&id,"thumbnail")?;if !frame.is_empty(){let image=image::load_from_memory(&frame).map_err(|e|e.to_string())?.thumbnail(320,180).to_rgb8();let mut jpeg=Vec::new();image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg,70).encode_image(&image).map_err(|e|e.to_string())?;return Ok(Response::new(jpeg))}std::thread::sleep(Duration::from_millis(50));}Err("Capture preview timed out. Check Screen Recording permission.".into())}).await.map_err(|e|e.to_string())?
}
#[tauri::command]pub async fn native_capture_start(id:String,consumer:String,window:Window,capture:State<'_,NativeCapture>)->Result<(),String>{capture.start(&id,format!("{}:{consumer}",window.label()))}
#[tauri::command]pub fn native_capture_frame(id:String,consumer:String,window:Window,capture:State<NativeCapture>)->Result<Response,String>{capture.frame(&id,&format!("{}:{consumer}",window.label())).map(Response::new)}
#[tauri::command]pub async fn native_capture_stop(id:String,consumer:String,window:Window,capture:State<'_,NativeCapture>)->Result<(),String>{capture.release(Some(&id),&format!("{}:{consumer}",window.label()),false);Ok(())}
