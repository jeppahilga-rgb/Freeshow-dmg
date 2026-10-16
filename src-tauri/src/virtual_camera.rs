use std::{ffi::c_void,fs::{File,OpenOptions},os::windows::{fs::OpenOptionsExt,io::AsRawHandle},sync::{Arc,Mutex,atomic::{AtomicBool,AtomicU32,AtomicU64,Ordering}},time::{Duration,Instant}};
use tauri::{Manager,Window,State};
use windows_capture::{capture::{CaptureControl,Context,GraphicsCaptureApiHandler},frame::Frame,graphics_capture_api::InternalCaptureControl,settings::*};
type Error=Box<dyn std::error::Error+Send+Sync>;
const WIDTH:usize=1280;const HEIGHT:usize=720;const BYTES:usize=WIDTH*HEIGHT*4;const SIZE:usize=64+BYTES*2;
#[repr(C)]
struct Header{magic:u32,version:u32,width:u32,height:u32,index:AtomicU32,active:AtomicU32,sequence:[AtomicU32;2],heartbeat:AtomicU64,reserved:[u8;24]}
#[link(name="kernel32")]
extern "system"{
 fn CreateFileMappingW(file:*mut c_void,security:*const c_void,protect:u32,high:u32,low:u32,name:*const u16)->*mut c_void;
 fn MapViewOfFile(mapping:*mut c_void,access:u32,high:u32,low:u32,size:usize)->*mut c_void;
 fn UnmapViewOfFile(view:*const c_void)->i32;fn CloseHandle(handle:*mut c_void)->i32;fn GetTickCount64()->u64;
}
struct Writer{view:*mut u8,mapping:*mut c_void,_file:File,_lock:File,received:bool}
// All access to the mapping is serialized by Flags.writer's mutex.
unsafe impl Send for Writer{}
impl Writer{
 fn new()->Result<Self,String>{
  let directory=std::path::PathBuf::from(std::env::var_os("ProgramData").ok_or("ProgramData unavailable")?).join("FreeShowVirtualCamera");
  if !directory.join("FreeShowVirtualCamera.dll").exists(){return Err("Install the FreeShow Virtual Camera component first.".into())}
  let lock=OpenOptions::new().create(true).read(true).write(true).share_mode(0).open(directory.join("producer.lock")).map_err(|_|"Another FreeShow instance is already producing virtual-camera video.")?;
  let file=OpenOptions::new().create(true).read(true).write(true).share_mode(3).open(directory.join("frame.bin")).map_err(|e|e.to_string())?;
  file.set_len(SIZE as u64).map_err(|e|e.to_string())?;
  unsafe{
   let mapping=CreateFileMappingW(file.as_raw_handle(),std::ptr::null(),4,0,SIZE as u32,std::ptr::null());
   if mapping.is_null(){return Err(std::io::Error::last_os_error().to_string())}
   let view=MapViewOfFile(mapping,2,0,0,SIZE) as *mut u8;
   if view.is_null(){CloseHandle(mapping);return Err(std::io::Error::last_os_error().to_string())}
   std::ptr::write(view.cast::<Header>(),Header{magic:0x4653434d,version:1,width:WIDTH as u32,height:HEIGHT as u32,index:AtomicU32::new(0),active:AtomicU32::new(0),sequence:[AtomicU32::new(0),AtomicU32::new(0)],heartbeat:AtomicU64::new(0),reserved:[0;24]});
   Ok(Self{view,mapping,_file:file,_lock:lock,received:false})
  }
 }
 fn header(&self)->&Header{unsafe{&*self.view.cast::<Header>()}}
 fn push(&mut self,rgba:&[u8],width:usize,height:usize){
  if width==0||height==0||rgba.len()<width*height*4{return}
  let header=self.header();let index=(header.index.load(Ordering::Relaxed)^1) as usize;
  header.sequence[index].fetch_add(1,Ordering::AcqRel);
  let pixels=unsafe{std::slice::from_raw_parts_mut(self.view.add(64+index*BYTES),BYTES)};
  let scale=(WIDTH as f64/width as f64).min(HEIGHT as f64/height as f64);
  let fitted_width=(width as f64*scale).round().max(1.0) as usize;let fitted_height=(height as f64*scale).round().max(1.0) as usize;
  let left=(WIDTH-fitted_width)/2;let top=(HEIGHT-fitted_height)/2;
  pixels.fill(0);
  for y in 0..fitted_height{for x in 0..fitted_width{
   let source=((y*height/fitted_height)*width+x*width/fitted_width)*4;let destination=((y+top)*WIDTH+x+left)*4;
   pixels[destination..destination+4].copy_from_slice(&[rgba[source+2],rgba[source+1],rgba[source],255]);
  }}
  header.sequence[index].fetch_add(1,Ordering::Release);header.index.store(index as u32,Ordering::Release);
  header.heartbeat.store(unsafe{GetTickCount64()},Ordering::Release);header.active.store(1,Ordering::Release);self.received=true;
 }
}
impl Drop for Writer{fn drop(&mut self){self.header().active.store(0,Ordering::Release);unsafe{UnmapViewOfFile(self.view.cast());CloseHandle(self.mapping);}}}
#[derive(Clone)]struct Flags{writer:Arc<Mutex<Writer>>,closed:Arc<AtomicBool>}
struct Handler{flags:Flags,last:Instant,padding:Vec<u8>}
impl GraphicsCaptureApiHandler for Handler{
 type Flags=Flags;type Error=Error;
 fn new(context:Context<Flags>)->Result<Self,Error>{Ok(Self{flags:context.flags,last:Instant::now()-Duration::from_secs(1),padding:vec![]})}
 fn on_frame_arrived(&mut self,frame:&mut Frame,_control:InternalCaptureControl)->Result<(),Error>{
  if self.last.elapsed()<Duration::from_millis(33){return Ok(())}self.last=Instant::now();
  let width=frame.width() as usize;let height=frame.height() as usize;let buffer=frame.buffer()?;
  self.flags.writer.lock().map_err(|_|"Virtual camera lock unavailable")?.push(buffer.as_nopadding_buffer(&mut self.padding),width,height);Ok(())
 }
 fn on_closed(&mut self)->Result<(),Error>{self.flags.closed.store(true,Ordering::Release);if let Ok(writer)=self.flags.writer.lock(){writer.header().active.store(0,Ordering::Release)}Ok(())}
}
struct Session{output:String,flags:Flags,control:Option<CaptureControl<Handler,Error>>,heartbeat:Option<std::thread::JoinHandle<()>>}
impl Drop for Session{fn drop(&mut self){self.flags.closed.store(true,Ordering::Release);if let Some(control)=self.control.take(){let _=control.stop();}if let Some(thread)=self.heartbeat.take(){let _=thread.join();}if let Ok(writer)=self.flags.writer.lock(){writer.header().active.store(0,Ordering::Release)}}}
#[derive(Default)]pub struct VirtualCamera(Mutex<Option<Session>>);
#[tauri::command]
pub async fn virtual_camera(app:tauri::AppHandle,window:Window,state:State<'_,VirtualCamera>,action:String,output:Option<String>)->Result<serde_json::Value,String>{
 if window.label()!="main"{return Err("Virtual-camera controls are available in the editor only.".into())}
 let mut session=state.0.lock().map_err(|_|"Virtual-camera state unavailable")?;
 if action=="preflight"{
  if session.is_some(){return Err("Stop the active virtual camera before choosing another output.".into())}
  let directory=std::path::PathBuf::from(std::env::var_os("ProgramData").ok_or("ProgramData unavailable")?).join("FreeShowVirtualCamera");
  if !directory.join("FreeShowVirtualCamera.dll").is_file(){return Err("Install the FreeShow Virtual Camera component first.".into())}
  if directory.join("producer.lock").exists(){let _lock=OpenOptions::new().read(true).write(true).share_mode(0).open(directory.join("producer.lock")).map_err(|_|"Another FreeShow instance is already producing virtual-camera video.")?;}
  return Ok(serde_json::json!({"ready":true}));
 }
 if action=="stop"{session.take();}
 else if action=="start"{
  if session.is_some(){return Err("Stop the active virtual camera before choosing another output.".into())}
  let id=output.ok_or("Select an output")?;
  let target=app.get_window(&format!("output-{id}")).ok_or("Enable and show this FreeShow output first.")?;
  if !target.is_visible().map_err(|e|e.to_string())?{return Err("Show the output window before starting the virtual camera.".into())}
  let handle=target.hwnd().map_err(|e|e.to_string())?;
  let flags=Flags{writer:Arc::new(Mutex::new(Writer::new()?)),closed:Arc::new(AtomicBool::new(false))};
  let control=Handler::start_free_threaded(Settings::new(windows_capture::window::Window::from_raw_hwnd(handle.0),CursorCaptureSettings::WithoutCursor,DrawBorderSettings::Default,SecondaryWindowSettings::Default,MinimumUpdateIntervalSettings::Default,DirtyRegionSettings::Default,ColorFormat::Rgba8,flags.clone())).map_err(|e|e.to_string())?;
  let heartbeat_flags=flags.clone();let heartbeat=std::thread::spawn(move||{while !heartbeat_flags.closed.load(Ordering::Acquire){if let Ok(writer)=heartbeat_flags.writer.lock(){if writer.received{writer.header().heartbeat.store(unsafe{GetTickCount64()},Ordering::Release)}}std::thread::sleep(Duration::from_millis(100));}});
  *session=Some(Session{output:id,flags,control:Some(control),heartbeat:Some(heartbeat)});
 }else if action!="status"{return Err("Unknown virtual-camera action".into())}
 if session.as_ref().is_some_and(|s|s.flags.closed.load(Ordering::Acquire)){session.take();}
 Ok(serde_json::json!({"running":session.is_some(),"output":session.as_ref().map(|s|&s.output),"width":WIDTH,"height":HEIGHT,"fps":30,"name":"FreeShow Virtual Camera"}))
}
#[cfg(test)]mod tests{use super::*;#[test]fn transport_layout(){assert_eq!(std::mem::size_of::<Header>(),64);assert_eq!(std::mem::offset_of!(Header,heartbeat),32);}}
