use crate::Library;
use serde_json::{json,Value};
use std::{collections::HashMap,fs,io::{BufRead,BufReader,Write},path::PathBuf,process::{Child,ChildStdin,Stdio},sync::{Arc,Mutex},time::Duration};
use tauri::{Emitter,Manager,State};
#[cfg(windows)] use windows::Win32::{Foundation::{CloseHandle,HANDLE},System::JobObjects::*};
#[cfg(windows)] use std::os::windows::io::AsRawHandle;
type Pending=Arc<Mutex<HashMap<String,tokio::sync::oneshot::Sender<Result<Value,String>>>>>;
struct Process {child:Child,#[cfg(windows)] job:usize,input:Arc<Mutex<ChildStdin>>,pending:Pending,root:PathBuf}
impl Drop for Process{fn drop(&mut self){for(_,sender)in self.pending.lock().unwrap().drain(){let _=sender.send(Err("Backend stopped".into()));}#[cfg(unix)] unsafe {libc::kill(-(self.child.id() as i32),libc::SIGKILL);}let _=self.child.kill();let _=self.child.wait();#[cfg(windows)] unsafe{let _=CloseHandle(HANDLE(self.job as *mut _));}}}
#[derive(Default)]pub struct BackendRuntime{process:Mutex<Option<Process>>}
impl BackendRuntime{
    pub fn is_started(&self)->bool{self.process.lock().unwrap().is_some()}
    pub fn stop(&self){self.process.lock().unwrap().take();}
    fn input(&self,app:&tauri::AppHandle,library:&Library)->Result<(Arc<Mutex<ChildStdin>>,Pending),String>{
        let mut slot=self.process.lock().unwrap();if let Some(p)=slot.as_mut(){if p.root!=library.root||p.child.try_wait().map_err(|e|e.to_string())?.is_some(){slot.take();}}
        if let Some(p)=slot.as_ref(){return Ok((p.input.clone(),p.pending.clone()));}
        let executable=std::env::current_exe().map_err(|e|e.to_string())?;
        #[cfg(target_os="macos")] let resources=Some(app.path().resource_dir().map_err(|e|e.to_string())?);
        #[cfg(not(target_os="macos"))] let resources:Option<PathBuf>=None;
        let installed=crate::platform::runtime_folder(&executable,resources.as_deref());
        let folder=if installed.join("backend.cjs").is_file(){installed}else if cfg!(debug_assertions){PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("backend-runtime/build")}else{return Err("The bundled backend runtime is missing. Reinstall FreeShow.".into())};
        let name=crate::platform::node_name(cfg!(windows));
        let node=if folder.join(name).is_file(){folder.join(name)}else if cfg!(debug_assertions){crate::desktop_services::tool(app,"node")?}else{return Err("The bundled Node engine is missing. Reinstall FreeShow.".into())};
        let app_data=app.path().app_local_data_dir().map_err(|e|e.to_string())?;fs::create_dir_all(&app_data).map_err(|e|e.to_string())?;
        let boot=app_data.join("backend-boot.json");crate::write_json(boot.clone(),&json!({"libraryRoot":library.root,"appData":app_data,"hasConfig":library.root.join("Config").is_dir(),"paths":{"userData":app_data,"temp":app.path().temp_dir().map_err(|e|e.to_string())?,"documents":app.path().document_dir().map_err(|e|e.to_string())?,"music":app.path().audio_dir().map_err(|e|e.to_string())?,"videos":app.path().video_dir().map_err(|e|e.to_string())?,"pictures":app.path().picture_dir().map_err(|e|e.to_string())?}}))?;
        let mut command=crate::desktop_services::hidden(node);
        #[cfg(unix)] {use std::os::unix::process::CommandExt;command.process_group(0);}
        let mut child=command.arg(folder.join("backend.cjs")).current_dir(&folder).env("FREESHOW_BACKEND_CONFIG",boot).env("FREESHOW_BACKEND_CACHE",library.root.join("cache")).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e|e.to_string())?;
        #[cfg(windows)]
        let job=unsafe{( ||->Result<usize,String>{let h=CreateJobObjectW(None,None).map_err(|e|e.to_string())?;let mut info=JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();info.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;if let Err(e)=SetInformationJobObject(h,JobObjectExtendedLimitInformation,&info as *const _ as _,std::mem::size_of_val(&info) as u32){let _=CloseHandle(h);return Err(e.to_string());}if let Err(e)=AssignProcessToJobObject(h,HANDLE(child.as_raw_handle())){let _=CloseHandle(h);return Err(e.to_string());}Ok(h.0 as usize)})()};
        #[cfg(windows)]
        let job=match job{Ok(h)=>h,Err(e)=>{let _=child.kill();return Err(e)}};
        let input=Arc::new(Mutex::new(child.stdin.take().ok_or("Missing backend input")?));let output=child.stdout.take().ok_or("Missing backend output")?;let errors=child.stderr.take().ok_or("Missing backend errors")?;
        std::thread::spawn(move||{let mut reader=BufReader::new(errors);let mut ignored=String::new();loop{ignored.clear();if reader.read_line(&mut ignored).unwrap_or(0)==0{break;}}});
        let app=app.clone();let pending:Pending=Arc::default();let request_pending=pending.clone();let native_input=input.clone();
        std::thread::spawn(move||{let mut reader=BufReader::new(output);let mut line=String::new();loop{line.clear();if reader.read_line(&mut line).unwrap_or(0)==0{break;}if line.len()>64*1024*1024{continue;}let Ok(message)=serde_json::from_str::<Value>(&line)else{continue};match message["type"].as_str(){
            Some("response")=>{if let Some(id)=message["id"].as_str(){if let Some(sender)=pending.lock().unwrap().remove(id){let result=if let Some(error)=message["error"].as_str(){Err(error.into())}else{Ok(message["data"].clone())};let _=sender.send(result);}}},
            Some("event")=>{let _=app.emit_to("main","freeshow-ipc",json!({"channel":message["channel"],"msg":message["msg"],"id":message["id"]}));},
            Some("native")=>{let app=app.clone();let input=native_input.clone();tauri::async_runtime::spawn(async move{let result=native_action(&app,message["operation"].as_str().unwrap_or(""),message["data"].clone()).await;let reply=match result{Ok(data)=>json!({"type":"native-reply","id":message["id"],"data":data}),Err(error)=>json!({"type":"native-reply","id":message["id"],"error":error})};let _=write(&input,&reply);});},_=>{}
        }}for(_,sender)in pending.lock().unwrap().drain(){let _=sender.send(Err("Backend runtime exited".into()));}});
        *slot=Some(Process{child,#[cfg(windows)] job,input:input.clone(),pending:request_pending.clone(),root:library.root.clone()});Ok((input,request_pending))
    }
    pub async fn request(&self,app:&tauri::AppHandle,library:&Library,operation:String,data:Value)->Result<Value,String>{
        let (input,pending)=self.input(app,library)?;let id=uuid::Uuid::new_v4().to_string();let (sender,receiver)=tokio::sync::oneshot::channel();pending.lock().unwrap().insert(id.clone(),sender);
        if let Err(e)=write(&input,&json!({"id":id,"operation":operation,"data":data})){pending.lock().unwrap().remove(&id);return Err(e);}
        let result=tokio::time::timeout(Duration::from_secs(600),receiver).await;pending.lock().unwrap().remove(&id);result.map_err(|_|"Backend request timed out".to_string())?.map_err(|_|"Backend reply was lost".to_string())?
    }
}
fn write(input:&Arc<Mutex<ChildStdin>>,data:&Value)->Result<(),String>{let bytes=serde_json::to_vec(data).map_err(|e|e.to_string())?;if bytes.len()>64*1024*1024{return Err("Backend request too large".into());}let mut stream=input.lock().unwrap();stream.write_all(&bytes).and_then(|_|stream.write_all(b"\n")).and_then(|_|stream.flush()).map_err(|e|e.to_string())}
pub async fn protected_media(app:&tauri::AppHandle,label:&str,request:tauri::http::Request<Vec<u8>>)->Result<tauri::http::Response<Vec<u8>>,String>{
    use base64::Engine;
    if label!="main"&&!label.starts_with("output-"){return Err("Not an editor or output".into());}
    for header in ["origin","referer"]{if let Some(value)=request.headers().get(header){let value=value.to_str().map_err(|_|"Invalid origin")?;let url=reqwest::Url::parse(value).map_err(|_|"Invalid origin")?;let host=url.host_str().unwrap_or("");if !["tauri.localhost","localhost","127.0.0.1"].contains(&host)&&url.scheme()!="tauri"{return Err("Foreign origin".into());}}}
    if !["GET","HEAD"].contains(&request.method().as_str()){return Err("Invalid method".into());}
    let uri=request.uri();let id=uri.path().trim_start_matches('/');
    let value=app.state::<BackendRuntime>().request(app,&app.state::<Library>(),"PROTECTED_MEDIA".into(),json!({"id":id,"method":request.method().as_str(),"range":request.headers().get("range").and_then(|v|v.to_str().ok()).unwrap_or("")})).await?;
    let bytes=base64::engine::general_purpose::STANDARD.decode(value["body"].as_str().unwrap_or("")).map_err(|_|"Invalid media payload")?;if bytes.len()>4194304{return Err("Media payload too large".into());}
    let mut response=tauri::http::Response::builder().status(value["status"].as_u64().unwrap_or(500) as u16);
    if let Some(origin)=request.headers().get("origin"){response=response.header("access-control-allow-origin",origin).header("vary","Origin");}
    for name in ["content-type","content-length","content-range","accept-ranges","cache-control","content-disposition"]{if let Some(v)=value["headers"][name].as_str(){response=response.header(name,v);}}
    response.body(bytes).map_err(|e|e.to_string())
}
async fn native_action(app:&tauri::AppHandle,operation:&str,data:Value)->Result<Value,String>{match operation{
    "ENGINE_FRAMERATE"=>{let id=data["id"].as_str().ok_or("Missing output ID")?;app.state::<crate::output_engines::OutputEngines>().set_rate(id,data["fps"].as_f64().unwrap_or(30.0).round() as u64);Ok(Value::Null)},
    "GET_OUTPUTS"=>Ok(json!(app.state::<crate::output_engines::OutputEngines>().all_outputs())),
    "FOCUS_MAIN"=>{app.get_window("main").ok_or("Editor closed")?.set_focus().map_err(|e|e.to_string())?;Ok(Value::Null)},
    "OUTPUT_VALUE"=>{let id=data["id"].as_str().ok_or("Missing output ID")?;if data["key"].as_str()!=Some("alwaysOnTop"){return Err("Invalid slideshow output setting".into());}if let Some(window)=app.get_window(&format!("output-{id}")){window.set_always_on_top(data["value"].as_bool().unwrap_or(false)).map_err(|e|e.to_string())?;}Ok(Value::Null)},
    "MEDIA_TRANSPORT"=>{let id=data["targetId"].as_str().ok_or("Missing media target")?;let label=if id=="app"{"main".to_owned()}else{format!("output-{id}")};app.emit_to(label,"freeshow-ipc",json!({"channel":"MEDIA_TRANSPORT","msg":{"channel":"CONNECT","data":data}})).map_err(|e|e.to_string())?;Ok(Value::Null)},
    "OPEN_URL"=>{let url=data["url"].as_str().ok_or("Missing URL")?;let parsed=reqwest::Url::parse(url).map_err(|e|e.to_string())?;if !["http","https"].contains(&parsed.scheme()){return Err("Use an HTTP(S) browser URL".into());}crate::platform::open_target(url,true)?;Ok(Value::Null)},
    "SYSTEM_OPEN"=>{let path=PathBuf::from(data["path"].as_str().ok_or("Missing path")?);if !path.is_absolute(){return Err("Absolute path required".into());}crate::platform::open_target(path,false)?;Ok(Value::Null)},
    "OPEN_FILE"=>{let window=app.get_window("main").ok_or("Editor closed")?;tauri::async_runtime::spawn_blocking(move||{let mut dialog=rfd::FileDialog::new().set_parent(&window);if let Some(title)=data["title"].as_str(){dialog=dialog.set_title(title);}let files=dialog.pick_files().unwrap_or_default();Ok(json!({"files":files}))}).await.map_err(|e|e.to_string())?},
    "SAVE_DIALOG"=>{let window=app.get_window("main").ok_or("Editor closed")?;tauri::async_runtime::spawn_blocking(move||{let mut dialog=rfd::FileDialog::new().set_parent(&window);if let Some(title)=data["title"].as_str(){dialog=dialog.set_title(title);}if let Some(name)=data["defaultPath"].as_str(){dialog=dialog.set_file_name(name);}Ok(json!(dialog.save_file()))}).await.map_err(|e|e.to_string())?},
    "ENCODER_CHANGED"=>{app.emit_to("main","freeshow-ipc",json!({"channel":"MAIN","msg":{"channel":"ENCODER_DETECT","data":data}})).map_err(|e|e.to_string())?;Ok(Value::Null)},
    _=>Err(format!("Unknown native backend action: {operation}"))
}}
#[tauri::command]
pub async fn backend_service(app:tauri::AppHandle,caller:tauri::Webview,library:State<'_,Library>,state:State<'_,BackendRuntime>,operation:String,data:Value)->Result<Value,String>{
    if caller.label()!=caller.window().label(){return Err("Backend services require a FreeShow window".into());}
    if caller.label()!="main"{
        let id=caller.label().strip_prefix("output-").ok_or("Backend services belong to the editor")?;
        if operation=="MEDIA_TRANSPORT"{if data["target"].as_str()!=Some(id){return Err("Wrong media target".into());}}
        else if operation=="AUDIO_CLOSE"{if data["id"].as_str()!=Some(id){return Err("Wrong audio target".into());}}
        else if operation=="MEDIA_CHANNEL"{if !["NDI","OMT","BLACKMAGIC"].contains(&data["channel"].as_str().unwrap_or(""))||!["CAPTURE_STREAM","CAPTURE_DESTROY","RECEIVE_STREAM","STOP_RECEIVER"].contains(&data["message"]["channel"].as_str().unwrap_or(""))||data["message"]["data"]["outputId"].as_str()!=Some(id){return Err("Invalid output media operation".into());}}
        else{return Err("Backend services belong to the editor".into());}
    }
    let commands:Vec<String>=serde_json::from_str(include_str!("../backend-runtime/commands.json")).map_err(|e|e.to_string())?;if !["REPLY","IMPORT_BINARY","MEDIA_CHANNEL","MEDIA_TRANSPORT","AUDIO_CLOSE","WHIP_SIGNAL","LEGACY_CLOUD","GOOGLE_FONTS"].contains(&operation.as_str())&&!commands.contains(&operation){return Err("Unknown backend operation".into());}
    state.request(&app,&library,operation,data).await
}
