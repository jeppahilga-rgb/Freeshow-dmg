use std::{collections::{HashMap,HashSet}, time::Instant};
use tauri::{Manager, Webview, WebviewUrl};
use serde_json::{Value,json};

struct Source { label:String, consumers:HashMap<String,bool>, active:HashSet<String>, frame:Vec<u8>, captured:Instant, width:f64, height:f64, paused:bool, muted:bool, revision:u64, delivered:HashMap<String,u64> }
fn should_mute(muted:bool,consumers:&HashMap<String,bool>)->bool{muted||!consumers.values().any(|audible|*audible)}
#[derive(Default)]
pub struct SharedWebsites(tokio::sync::Mutex<HashMap<String,Source>>);

#[tauri::command]
pub async fn website_source_activity(caller:Webview,state:tauri::State<'_,SharedWebsites>,paused:bool)->Result<(),String> {
    if !caller.label().starts_with("website-source-") || caller.label()!=caller.window().label(){return Err("Website source only".into())}
    let mut sources=state.0.lock().await;
    let source=sources.values_mut().find(|source|source.label==caller.label()).ok_or("Website source closed")?;
    source.paused=paused;source.frame.clear();Ok(())
}

#[tauri::command]
pub async fn website_source_fullscreen(app:tauri::AppHandle,caller:Webview,state:tauri::State<'_,SharedWebsites>,expanded:bool)->Result<(),String> {
    if !caller.label().starts_with("website-source-") || caller.label()!=caller.window().label() {return Err("Website source only".into())}
    let mut sources=state.0.lock().await;
    let source=sources.values_mut().find(|source|source.label==caller.label()).ok_or("Website source closed")?;
    let window=app.get_webview_window(&source.label).ok_or("Website source closed")?;
    // Page fullscreen is confined to the browser's current client area.
    // Never promote this control window to monitor fullscreen.
    if window.is_fullscreen().map_err(|e|e.to_string())? {window.set_fullscreen(false).map_err(|e|e.to_string())?;}
    let _=expanded;
    source.frame.clear();
    Ok(())
}

pub fn hide_controls(app:tauri::AppHandle,label:String) {
    tauri::async_runtime::spawn(async move {
        let state=app.state::<SharedWebsites>();
        let mut sources=state.0.lock().await;
        if let Some(source)=sources.values_mut().find(|source|source.label==label) {
            if let Some(window)=app.get_webview_window(&label) {
                let _=window.hide();
                let _=window.set_fullscreen(false);
                let _=window.unmaximize();
                let _=window.set_size(tauri::LogicalSize::new(source.width,source.height));
                source.frame.clear();
                if source.active.is_empty() {let _=window.eval("window.__freeshowInput?.({type:'pause'})");}
            }
        }
    });
}

pub fn close_window(app:tauri::AppHandle,label:String) {
    tauri::async_runtime::spawn(async move {
        let state=app.state::<SharedWebsites>();
        let mut sources=state.0.lock().await;
        let prefix=format!("{label}-website-");
        let mut remove=vec![];
        for (key,source) in sources.iter_mut() {
            source.consumers.retain(|id,_|!id.starts_with(&prefix));
            source.active.retain(|id|!id.starts_with(&prefix));source.delivered.retain(|id,_|!id.starts_with(&prefix));
            if source.consumers.is_empty() {if let Some(view)=app.get_webview_window(&source.label){let _=view.destroy();}remove.push(key.clone());}
            else if let Some(view)=app.get_webview(&source.label){let _=pause_if_idle(source,&view);let _=super::websites::set_audio(&view,should_mute(source.muted,&source.consumers)).await;}
        }
        for key in remove {sources.remove(&key);}
    });
}

fn trusted(caller:&Webview)->Result<(),String> {
    if caller.label()!=caller.window().label() || !(caller.label()=="main"||caller.label().starts_with("output-")) {return Err("Editor or output only".into())} Ok(())
}

fn pause_if_idle(source:&Source,view:&Webview)->Result<(),String> {
    if source.active.is_empty() && !view.window().is_visible().map_err(|e|e.to_string())? {
        view.eval("window.__freeshowInput?.({type:'pause'})").map_err(|e|e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn shared_website(app:tauri::AppHandle, caller:Webview, state:tauri::State<'_,SharedWebsites>, id:String, url:String, action:String, data:Option<Value>)->Result<Value,String> {
    trusted(&caller)?;
    if !id.starts_with(&format!("{}-website-",caller.label())) || id.len()>150 {return Err("Invalid consumer".into())}
    let parsed=tauri::Url::parse(&url).map_err(|e|e.to_string())?;
    if !matches!(parsed.scheme(),"http"|"https") {return Err("Only websites".into())}
    let key=parsed.as_str().to_owned();
    let mut sources=state.0.lock().await;
    if action=="close" {
        if let Some(source)=sources.get_mut(&key) {source.delivered.remove(&id);source.active.remove(&id);source.consumers.remove(&id);if source.consumers.is_empty() {if let Some(view)=app.get_webview_window(&source.label){let _=view.destroy();}sources.remove(&key);}else if let Some(view)=app.get_webview(&source.label){pause_if_idle(source,&view)?;super::websites::set_audio(&view,should_mute(source.muted,&source.consumers)).await?;}}
        return Ok(Value::Null)
    }
    if action=="show" && !sources.contains_key(&key) {
        let label=format!("website-source-{}",uuid::Uuid::new_v4());
        let settings=data.as_ref().unwrap_or(&Value::Null);
        let width=settings["width"].as_f64().unwrap_or(1920.0).clamp(320.0,3840.0);
        let height=settings["height"].as_f64().unwrap_or(1080.0).clamp(180.0,2160.0);
        tauri::WebviewWindowBuilder::new(&app,&label,WebviewUrl::External(parsed.clone()))
            .title("FreeShow website controls — close to hide").inner_size(width,height).position(-12000.0,-12000.0)
            // Start hidden; preview clicks explicitly open the browser controls.
            // Off-screen positioning alone can be corrected by Windows.
            .decorations(true).skip_taskbar(true).focused(false).visible(false)
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .data_directory(app.path().app_cache_dir().map_err(|e|e.to_string())?.join("website-sources-capture-v2"))
            .additional_browser_args("--disable-gpu-compositing --disable-direct-composition --disable-direct-composition-video-overlays --autoplay-policy=no-user-gesture-required --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-features=CalculateNativeWinOcclusion")
            .initialization_script(include_str!("shared_website.js"))
            .build().map_err(|e|e.to_string())?;
        sources.insert(key.clone(),Source{label,consumers:HashMap::new(),active:HashSet::new(),frame:vec![],captured:Instant::now()-std::time::Duration::from_secs(1),width,height,paused:false,muted:false,revision:0,delivered:HashMap::new()});
    }
    let source=sources.get_mut(&key).ok_or("Website is not running")?;
    if action=="show" {source.active.insert(id.clone());source.consumers.insert(id.clone(),caller.label().starts_with("output-"));}
    if !source.consumers.contains_key(&id) {return Err("Unregistered consumer".into())}
    let view=app.get_webview(&source.label).ok_or("Website source closed")?;
    if action=="show" || action=="hide" {
        if action=="hide" {source.active.remove(&id);source.consumers.insert(id,false);}
        if source.active.is_empty() && !view.window().is_visible().map_err(|e|e.to_string())? {view.eval("window.__freeshowInput?.({type:'pause'})").map_err(|e|e.to_string())?;}
        super::websites::set_audio(&view,should_mute(source.muted,&source.consumers)).await?;
        if let Some(zoom)=data.as_ref().and_then(|d|d["zoom"].as_f64()) {view.set_zoom(zoom.clamp(0.1,5.0)).map_err(|e|e.to_string())?;}
    } else if action=="control" {
        if caller.label()!="main" {return Err("Editor controls only".into())}
        let window=view.window();
        window.set_fullscreen(false).map_err(|e|e.to_string())?;
        window.unmaximize().map_err(|e|e.to_string())?;
        window.set_size(tauri::LogicalSize::new(800.0,450.0)).map_err(|e|e.to_string())?;
        source.frame.clear();
        window.center().map_err(|e|e.to_string())?;
        window.show().map_err(|e|e.to_string())?;
        window.set_focus().map_err(|e|e.to_string())?;
    } else if action=="mute" {
        source.muted=data.as_ref().and_then(|value|value["muted"].as_bool()).ok_or("Missing mute state")?;
        super::websites::set_audio(&view,should_mute(source.muted,&source.consumers)).await?;
    } else if action=="input" {
        let data=data.ok_or("Missing input")?;
        let kind=data["type"].as_str().ok_or("Missing input type")?;
        if !["click","wheel","key","back","forward","reload","play"].contains(&kind) || data.to_string().len()>4096 {return Err("Invalid input".into())}
        if kind=="reload" {view.navigate(parsed).map_err(|e|e.to_string())?;}else{view.eval(&format!("window.__freeshowInput?.({})",data)).map_err(|e|e.to_string())?;}
    } else if action!="status" {return Err("Unknown website action".into())}
    let mut status=if action=="show"||action=="status"{super::websites::navigation(&view,"status").await?}else{json!({})};
    status["url"]=json!(view.url().map_err(|e|e.to_string())?.as_str());Ok(status)
}

#[tauri::command]
pub async fn shared_website_frame(app:tauri::AppHandle, caller:Webview, state:tauri::State<'_,SharedWebsites>, id:String, url:String)->Result<tauri::ipc::Response,String> {
    trusted(&caller)?;
    let parsed=tauri::Url::parse(&url).map_err(|e|e.to_string())?;
    let mut sources=state.0.lock().await;
    let source=sources.get_mut(parsed.as_str()).ok_or("Website is not running")?;
    if !id.starts_with(&format!("{}-website-",caller.label())) || !source.consumers.contains_key(&id) {return Err("Unregistered consumer".into())}
    if source.frame.is_empty() || source.captured.elapsed().as_millis()>=if source.paused {250} else {30} {
        let view=app.get_webview(&source.label).ok_or("Website source closed")?;
        let started=Instant::now();
        source.frame=capture(&view).await?; source.captured=started;
        source.revision=source.revision.wrapping_add(1);
    }
    if source.delivered.get(&id)==Some(&source.revision){return Ok(tauri::ipc::Response::new(Vec::<u8>::new()))}
    source.delivered.insert(id,source.revision);
    Ok(tauri::ipc::Response::new(source.frame.clone()))
}

#[cfg(windows)]
async fn capture(view:&Webview)->Result<Vec<u8>,String> {
    use windows::Win32::System::Com::{StructuredStorage::CreateStreamOnHGlobal,STATSTG,STATFLAG_NONAME,STREAM_SEEK_SET};
    use webview2_com::{CapturePreviewCompletedHandler,Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_JPEG};
    let (send,receive)=tokio::sync::oneshot::channel();
    view.with_webview(move |platform| {
        let start=(||->windows::core::Result<()> {
            let core=unsafe{platform.controller().CoreWebView2()}?;
            let stream=unsafe{CreateStreamOnHGlobal(Default::default(),true)}?;
            let output=stream.clone();
            let callback=CapturePreviewCompletedHandler::create(Box::new(move |result| {
                let bytes=(||->Result<Vec<u8>,String> {
                    result.map_err(|e|e.to_string())?;
                    let mut stat=STATSTG::default();unsafe{output.Stat(&mut stat,STATFLAG_NONAME)}.map_err(|e|e.to_string())?;
                    if stat.cbSize>16_000_000 {return Err("Website frame too large".into())}
                    let mut bytes=vec![0;stat.cbSize as usize];let mut read=0;
                    unsafe{output.Seek(0,STREAM_SEEK_SET,None)}.map_err(|e|e.to_string())?;
                    unsafe{output.Read(bytes.as_mut_ptr().cast(),bytes.len() as u32,Some(&mut read))}.ok().map_err(|e|e.to_string())?;
                    bytes.truncate(read as usize);Ok(bytes)
                })();let _=send.send(bytes);Ok(())
            }));
            unsafe{core.CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_JPEG,&stream,&callback)}?;
            Ok(())
        })(); if let Err(error)=start {eprintln!("Website capture: {error}");}
    }).map_err(|e|e.to_string())?;
    tokio::time::timeout(std::time::Duration::from_secs(3),receive).await.map_err(|_|"Website capture timed out".to_string())?.map_err(|_|"Website capture unavailable".to_string())?
}
#[cfg(target_os="macos")]
async fn capture(view:&Webview)->Result<Vec<u8>,String>{
 use objc2::{MainThreadMarker,AllocAnyThread};
 use objc2_app_kit::{NSImage,NSBitmapImageRep,NSBitmapImageFileType,NSImageCompressionFactor};
 use objc2_foundation::{NSError,NSDictionary,NSNumber,NSString};
 use objc2_web_kit::{WKWebView,WKSnapshotConfiguration};
 let (sender,receiver)=tokio::sync::oneshot::channel();
 view.with_webview(move|platform|{unsafe{
  let web=&*(platform.inner() as *mut WKWebView);
  let config=WKSnapshotConfiguration::new(MainThreadMarker::new().expect("WebKit main thread"));config.setAfterScreenUpdates(false);
  let sender=std::sync::Mutex::new(Some(sender));
  let callback=block2::RcBlock::new(move|image:*mut NSImage,error:*mut NSError|{
   let result=(||->Result<Vec<u8>,String>{
    if !error.is_null(){return Err((&*error).localizedDescription().to_string())}
    let image=image.as_ref().ok_or("Website snapshot unavailable")?;
    let tiff=image.TIFFRepresentation().ok_or("Website image unavailable")?;
    let bitmap=NSBitmapImageRep::initWithData(NSBitmapImageRep::alloc(),&tiff).ok_or("Website bitmap unavailable")?;
    let quality=NSNumber::new_f64(0.98);
    let properties=NSDictionary::<NSString,objc2::runtime::AnyObject>::from_slices(&[NSImageCompressionFactor],&[&*quality]);
    let bytes=bitmap.representationUsingType_properties(NSBitmapImageFileType::JPEG,&properties).ok_or("Website JPEG unavailable")?;
    Ok(bytes.to_vec())
   })();if let Some(sender)=sender.lock().unwrap().take(){let _=sender.send(result);}
  });
  web.takeSnapshotWithConfiguration_completionHandler(Some(&config),&callback);
 }}).map_err(|e|e.to_string())?;
 tokio::time::timeout(std::time::Duration::from_secs(5),receiver).await.map_err(|_|"Website capture timed out")?.map_err(|_|"Website capture unavailable")?
}




#[cfg(test)]
mod mute_tests {
    use super::*;
    #[test]
    fn explicit_mute_survives_active_output_changes() {
        let mut consumers=HashMap::new();
        consumers.insert("preview".into(),false);
        assert!(should_mute(false,&consumers));
        consumers.insert("output".into(),true);
        assert!(!should_mute(false,&consumers));
        assert!(should_mute(true,&consumers));
        consumers.remove("preview");
        assert!(should_mute(true,&consumers));
        assert!(!should_mute(false,&consumers));
        consumers.clear();
        assert!(should_mute(false,&consumers));
    }
}
