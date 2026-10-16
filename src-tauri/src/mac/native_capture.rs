use tauri::{Window,State,ipc::Response};
const UNAVAILABLE:&str="Native window/screen capture is not available in this Mac core preview. Use a media file or a camera input instead.";
#[derive(Default,Clone)] pub struct NativeCapture;
impl NativeCapture {
 pub fn close_window(&self,_label:&str){}
 pub fn server_frame(&self,_window:Window,_owner:String)->Result<Vec<u8>,String>{Err(UNAVAILABLE.into())}
}
pub fn window_jpeg(_handle:usize)->Result<Vec<u8>,String>{Err(UNAVAILABLE.into())}
pub fn window_handle(_window:&Window)->Result<usize,String>{Err(UNAVAILABLE.into())}
#[tauri::command] pub fn native_sources()->Result<Vec<serde_json::Value>,String>{Err(UNAVAILABLE.into())}
#[tauri::command] pub fn native_capture_browser(url:String,window:Window)->Result<(),String>{
 if window.label()!="main"{return Err("Editor only".into())}
 let parsed=reqwest::Url::parse(&url).map_err(|e|e.to_string())?;
 if !["http","https"].contains(&parsed.scheme()){return Err("HTTP(S) URL required".into())}
 crate::platform::open_target(url,true)
}
#[tauri::command] pub async fn native_thumbnail(id:String)->Result<Response,String>{Err(UNAVAILABLE.into())}
#[tauri::command] pub async fn native_capture_start(id:String,consumer:String,_window:Window,_capture:State<'_,NativeCapture>)->Result<(),String>{Err(UNAVAILABLE.into())}
#[tauri::command] pub fn native_capture_frame(id:String,consumer:String,_window:Window,_capture:State<NativeCapture>)->Result<Response,String>{Err(UNAVAILABLE.into())}
#[tauri::command] pub async fn native_capture_stop(id:String,consumer:String,_window:Window,_capture:State<'_,NativeCapture>)->Result<(),String>{Ok(())}
