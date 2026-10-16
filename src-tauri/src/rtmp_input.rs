use serde_json::{json, Value};
use std::{fs, net::{TcpListener,UdpSocket}, process::{Child,Command,Stdio}, sync::Mutex, time::Duration};
use tauri::{Manager, State};
use std::os::windows::{process::CommandExt,io::AsRawHandle};
use windows::Win32::{Foundation::{CloseHandle,HANDLE},System::JobObjects::*};

struct Running { child:Child, job:usize, id:String, key:String, http:u16, api:u16, urls:Vec<String> }
impl Drop for Running { fn drop(&mut self) { let _=self.child.kill(); let _=self.child.wait(); unsafe { let _=CloseHandle(HANDLE(self.job as *mut _)); } } }
#[derive(Default)]
pub struct RtmpInput { inner:Mutex<Option<Running>> }
impl RtmpInput { pub fn stop(&self) { self.inner.lock().unwrap().take(); } }
fn tcp_listener(host:&str,preferred:u16) -> Result<TcpListener,String> { TcpListener::bind((host,preferred)).or_else(|_|TcpListener::bind((host,0))).map_err(|e|e.to_string()) }
fn config(key:&str, rtmp:u16,http:u16,api:u16,udp:u16) -> String {format!("logLevel: warn\nlogDestinations: [stdout]\nrtsp: false\nhls: false\nsrt: false\nmoq: false\nrtmp: true\nrtmpAddress: :{rtmp}\nwebrtc: true\nwebrtcAddress: 127.0.0.1:{http}\nwebrtcLocalUDPAddress: 0.0.0.0:{udp}\nwebrtcIPsFromInterfaces: true\nwebrtcAdditionalHosts: [127.0.0.1]\nwebrtcICEServers2: []\napi: true\napiAddress: 127.0.0.1:{api}\nauthInternalUsers:\n- user: any\n  ips: []\n  permissions:\n  - action: publish\n    path: {key}\n- user: any\n  ips: [127.0.0.1, '::1']\n  permissions:\n  - action: read\n    path: {key}\n  - action: api\npaths:\n  {key}:\n    source: publisher\n")}
fn launch(app:&tauri::AppHandle)->Result<Running,String> {
    let dir=app.path().app_local_data_dir().map_err(|e|e.to_string())?.join("rtmp-input/v1.21.2"); fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
    let exe=dir.join("mediamtx.exe"); let bundled=include_bytes!("../mediamtx/mediamtx.exe");
    if fs::read(&exe).ok().as_deref()!=Some(bundled.as_slice()) {fs::write(&exe,bundled).map_err(|e|e.to_string())?;}
    fs::write(dir.join("LICENSE-MediaMTX.txt"),include_bytes!("../mediamtx/LICENSE")).map_err(|e|e.to_string())?;
    let key=String::from("cam"); let id=format!("rtmp-{}",uuid::Uuid::new_v4().simple()); let listeners=[tcp_listener("0.0.0.0",1935)?,tcp_listener("127.0.0.1",0)?,tcp_listener("127.0.0.1",0)?]; let rtmp=listeners[0].local_addr().unwrap().port(); let http=listeners[1].local_addr().unwrap().port(); let api=listeners[2].local_addr().unwrap().port();
    let udp=UdpSocket::bind(("127.0.0.1",0)).map_err(|e|e.to_string())?.local_addr().unwrap().port();
    let cfg=dir.join("input.yml"); fs::write(&cfg,config(&key,rtmp,http,api,udp)).map_err(|e|e.to_string())?;
    let log=fs::File::create(dir.join("server.log")).map_err(|e|e.to_string())?;
    drop(listeners);
    let mut child=Command::new(&exe).arg(&cfg).current_dir(&dir).stdin(Stdio::null()).stdout(log.try_clone().map_err(|e|e.to_string())?).stderr(log).creation_flags(0x08000000).spawn().map_err(|e|e.to_string())?;
    let job=unsafe { (||->Result<usize,String>{
        let handle=CreateJobObjectW(None,None).map_err(|e|e.to_string())?;
        let mut info=JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default(); info.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if let Err(e)=SetInformationJobObject(handle,JobObjectExtendedLimitInformation,&info as *const _ as _,std::mem::size_of_val(&info) as u32) {let _=CloseHandle(handle);return Err(e.to_string());}
        if let Err(e)=AssignProcessToJobObject(handle,HANDLE(child.as_raw_handle())) {let _=CloseHandle(handle);return Err(e.to_string());}
        Ok(handle.0 as usize)
    })() };
    let job=match job {Ok(job)=>job,Err(e)=>{let _=child.kill();let _=child.wait();return Err(e)}};
    let mut ips:Vec<String>=local_ip_address::list_afinet_netifas().unwrap_or_default().into_iter().filter_map(|(_,ip)|match ip {std::net::IpAddr::V4(ip) if ip.is_private()=>Some(ip.to_string()),_=>None}).collect(); ips.sort_by_key(|ip|if ip.starts_with("192.168."){0}else{1}); ips.dedup();
    if ips.is_empty(){let _=child.kill();let _=child.wait();unsafe{let _=CloseHandle(HANDLE(job as *mut _));}return Err("Connect this PC to Wi-Fi or Ethernet before starting RTMP input.".into());}
    let urls=ips.iter().map(|ip|format!("rtmp://{ip}:{rtmp}/{key}")).collect();
    Ok(Running{child,job,id,key,http,api,urls})
}
fn client()->Result<reqwest::Client,String> {reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(8)).redirect(reqwest::redirect::Policy::none()).build().map_err(|e|e.to_string())}
#[tauri::command]
pub async fn rtmp_input_start(app:tauri::AppHandle,state:State<'_,RtmpInput>)->Result<Value,String> {
    let result={let mut lock=state.inner.lock().unwrap(); if let Some(r)=lock.as_mut(){if r.child.try_wait().map_err(|e|e.to_string())?.is_some(){lock.take();}}
        if lock.is_none(){*lock=Some(launch(&app)?);}
        let r=lock.as_ref().unwrap();json!({"id":r.id,"urls":r.urls,"key":r.key,"api":r.api})};
    let c=client()?; for _ in 0..30 {if c.get(format!("http://127.0.0.1:{}/v3/paths/list",result["api"])).timeout(Duration::from_millis(300)).send().await.is_ok_and(|r|r.status().is_success()){return Ok(result);}tokio::time::sleep(Duration::from_millis(100)).await;}
    state.stop();Err("RTMP input could not start. Another application may be using its ports. See the RTMP server log in FreeShow's app data folder.".into())
}
#[tauri::command]
pub fn rtmp_input_stop(state:State<'_,RtmpInput>){state.stop();}
#[tauri::command]
pub async fn rtmp_input_request(app:tauri::AppHandle,state:State<'_,RtmpInput>,id:String,action:String,sdp:Option<String>,session:Option<String>)->Result<Value,String>{
    let (key,http,api)={let lock=state.inner.lock().unwrap();let r=lock.as_ref().ok_or("Start RTMP camera input first.")?;if id!=r.id{return Err("RTMP input was stopped or restarted. Select its current camera card.".into());}(r.key.clone(),r.http,r.api)};
    if action=="diagnostic" { let message=sdp.unwrap_or_default(); if message.len()>4096{return Err("Diagnostic too large".into());} let folder=app.path().app_local_data_dir().map_err(|e|e.to_string())?.join("rtmp-input/v1.21.2"); let log=folder.join("receiver.log"); if fs::metadata(&log).is_ok_and(|m|m.len()>65536){let _=fs::rename(&log,folder.join("receiver-previous.log"));} use std::io::Write; let mut file=fs::OpenOptions::new().create(true).append(true).open(log).map_err(|e|e.to_string())?; writeln!(file,"{message}").map_err(|e|e.to_string())?; return Ok(json!({})); }
    let c=client()?;
    if action=="status" {let response=c.get(format!("http://127.0.0.1:{api}/v3/paths/get/{key}")).send().await.map_err(|e|e.to_string())?; if !response.status().is_success(){return Ok(json!({"ready":false}));} return response.json().await.map_err(|e|e.to_string());}
    if action=="offer" {let sdp=sdp.ok_or("Missing SDP")?;if sdp.len()>65536{return Err("SDP too large".into());}let response=c.post(format!("http://127.0.0.1:{http}/{key}/whep")).timeout(Duration::from_secs(20)).header("Content-Type","application/sdp").body(sdp).send().await.map_err(|e|e.to_string())?;if !response.status().is_success(){return Err("Waiting for RTMP camera. Start livestreaming in DJI Mimo using the address shown in FreeShow.".into());}let location=response.headers().get("location").and_then(|v|v.to_str().ok()).unwrap_or("").to_string();let answer=response.text().await.map_err(|e|e.to_string())?;return Ok(json!({"sdp":answer,"session":location}));}
    if action=="delete" {let session=session.ok_or("Missing session")?;let prefix=format!("/{key}/whep/");if !session.starts_with(&prefix)||session.contains("..")||session.contains('?')||session.contains('#'){return Err("Invalid receiver session".into());}let _=c.delete(format!("http://127.0.0.1:{http}{session}")).send().await;return Ok(json!({}));}
    Err("Unknown RTMP action".into())
}
