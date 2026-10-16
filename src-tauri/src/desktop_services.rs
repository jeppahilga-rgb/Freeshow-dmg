use crate::{Library, load, write_json};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::{fs, io::{Read, Seek, SeekFrom, Write}, path::{Path,PathBuf}, process::Command, sync::Mutex};
#[cfg(windows)] use std::os::windows::process::CommandExt;
use tauri::{Manager, State};

#[derive(Default)]
pub struct DesktopServices { pub playing: Mutex<Value>, recordings:Mutex<std::collections::HashMap<String,Recording>> }
struct Recording { file:fs::File, temporary:PathBuf, destination:PathBuf, offset:u64 }
impl Drop for Recording {fn drop(&mut self){let _=fs::remove_file(&self.temporary);}}
fn recording_destination(library:&Library,data:&Value)->Result<PathBuf,String>{
    let folder=if data["path"].as_str().is_some(){absolute(data,"path")?}else{library.root.join("Recordings")};
    fs::create_dir_all(&folder).map_err(|e|e.to_string())?;let name=crate::library_services::file_name(data["name"].as_str().unwrap_or("Recording.webm"));
    let path=folder.join(&name);let stem=path.file_stem().unwrap_or_default().to_string_lossy();let ext=path.extension().map(|s|format!(".{}",s.to_string_lossy())).unwrap_or_default();
    for n in 0..10000{let target=if n==0{path.clone()}else{folder.join(format!("{stem} {n}{ext}"))};if !target.exists(){return Ok(target)}}Err("Too many duplicate recordings".into())
}
pub fn hidden(program: impl AsRef<std::ffi::OsStr>) -> Command { #[allow(unused_mut)] let mut c=Command::new(program);#[cfg(windows)] c.creation_flags(0x08000000);c }
pub fn tool(app:&tauri::AppHandle,name:&str)->Result<PathBuf,String>{
    #[cfg(not(windows))] {
        let local=app.path().app_local_data_dir().map_err(|e|e.to_string())?.join("bin").join(name);
        if local.is_file(){return Ok(local)}
        let mut folders=std::env::var_os("PATH").map(|value|std::env::split_paths(&value).collect::<Vec<_>>()).unwrap_or_default();
        folders.extend([PathBuf::from("/opt/homebrew/bin"),PathBuf::from("/usr/local/bin"),PathBuf::from("/usr/bin")]);
        return folders.into_iter().map(|folder|folder.join(name)).find(|path|path.is_file()).ok_or_else(||format!("{name} is not installed. Install the required media tool."));
    }
    #[cfg(windows)] {
    let local=app.path().app_local_data_dir().map_err(|e|e.to_string())?.join("bin").join(format!("{name}.exe"));
    if local.is_file(){return Ok(local);}
    let found=hidden("where.exe").arg(format!("{name}.exe")).output().map_err(|e|e.to_string())?;
    String::from_utf8_lossy(&found.stdout).lines().map(PathBuf::from).find(|p|p.is_file()).ok_or_else(||if name=="ffprobe"{"FFprobe is not installed. Install the full FFmpeg toolset to inspect non-MP4 media.".into()}else{format!("{name} is not installed. Install FFmpeg from Settings.")})
    }
}
fn absolute(v:&Value,key:&str)->Result<PathBuf,String>{let p=PathBuf::from(v[key].as_str().or_else(||v.as_str()).ok_or("Missing path")?);if !p.is_absolute(){return Err("Absolute path required".into());}Ok(p)}
fn store_path(app:&tauri::AppHandle,library:&Library,file:&str)->Result<PathBuf,String>{
    if file.eq_ignore_ascii_case("config"){return Ok(app.path().app_local_data_dir().map_err(|e|e.to_string())?.join("config.json"));}
    let key=file.to_uppercase();if !crate::STORES.contains(&key.as_str())&&key!="ACCESS"{return Err("Unknown store".into());}Ok(library.store_path(&key))
}
fn get_key(value:&Value,key:&str)->Value{key.split('.').fold(value.clone(),|v,k|v[k].clone())}
fn show_has_content(show:&Value)->bool{
    if show["layouts"].as_object().is_some_and(|layouts|layouts.values().any(|layout|layout["slides"].as_array().is_some_and(|slides|!slides.is_empty()))){return true}
    show["slides"].as_object().is_some_and(|slides|slides.values().any(|slide|slide["items"].as_array().is_some_and(|items|items.iter().any(|item|item["lines"].as_array().is_some_and(|lines|lines.iter().any(|line|line["text"].as_array().is_some_and(|runs|runs.iter().any(|run|run["value"].as_str().is_some_and(|s|!s.is_empty())))))))))
}
fn export_image(bytes:Vec<u8>,format:&str)->Result<Vec<u8>,String>{
    let mut reader=image::ImageReader::new(std::io::Cursor::new(bytes)).with_guessed_format().map_err(|e|e.to_string())?;let mut limits=image::Limits::default();limits.max_image_width=Some(8192);limits.max_image_height=Some(8192);limits.max_alloc=Some(256*1024*1024);reader.limits(limits);let image=reader.decode().map_err(|e|e.to_string())?;let mut output=std::io::Cursor::new(Vec::new());image.write_to(&mut output,if format=="jpg"{image::ImageFormat::Jpeg}else{image::ImageFormat::Png}).map_err(|e|e.to_string())?;Ok(output.into_inner())
}
fn set_key(value:&mut Value,key:&str,data:Value)->Result<(),String>{
    let mut parts=key.split('.').peekable();let mut target=value;
    while let Some(k)=parts.next(){if k.is_empty()||["__proto__","prototype","constructor"].contains(&k){return Err("Invalid store key".into());}if !target.is_object(){*target=json!({});}if parts.peek().is_none(){target[k]=data;return Ok(());}target=target.as_object_mut().unwrap().entry(k).or_insert(json!({}));}Err("Missing store key".into())
}
fn media_folder(app:&tauri::AppHandle,library:&Library)->Result<PathBuf,String>{let config=load(store_path(app,library,"config")?)?;Ok(config["mediaFolderPath"].as_str().filter(|s|!s.is_empty()).map(PathBuf::from).unwrap_or_else(||library.root.join("Media")))}
fn copied_file(source:&Path,folder:&Path)->Result<PathBuf,String>{
    if !source.is_file(){return Err("Media source is not a file".into());}fs::create_dir_all(folder).map_err(|e|e.to_string())?;let name=source.file_name().ok_or("Missing filename")?;let mut dest=folder.join(name);let stem=source.file_stem().unwrap().to_string_lossy();let ext=source.extension().map(|v|format!(".{}",v.to_string_lossy())).unwrap_or_default();
    for n in 1..10000{if !dest.exists(){fs::copy(source,&dest).map_err(|e|e.to_string())?;return Ok(dest);}if fs::canonicalize(source).ok()==fs::canonicalize(&dest).ok(){return Ok(dest);}dest=folder.join(format!("{stem} {n}{ext}"));}Err("Too many duplicate media files".into())
}
fn inspect(app:&tauri::AppHandle,path:&Path)->Result<Value,String>{let output=hidden(tool(app,"ffprobe")?).args(["-v","error","-show_format","-show_streams","-of","json"]).arg(path).output().map_err(|e|e.to_string())?;if !output.status.success(){return Err(String::from_utf8_lossy(&output.stderr).chars().take(1024).collect());}serde_json::from_slice(&output.stdout).map_err(|e|e.to_string())}

#[tauri::command]
pub async fn desktop_service(app:tauri::AppHandle,caller:tauri::Webview,library:State<'_,Library>,services:State<'_,DesktopServices>,operation:String,data:Value)->Result<Value,String>{
    if caller.label()!= "main" || caller.label()!=caller.window().label(){return Err("Desktop services belong to the editor".into());}
    if operation.starts_with("RECORDING_"){
        let mut sessions=services.recordings.lock().unwrap();
        if operation=="RECORDING_BEGIN"{if sessions.len()>=4{return Err("Too many concurrent recording exports".into());}let destination=recording_destination(&library,&data)?;let id=uuid::Uuid::new_v4().to_string();let temporary=destination.with_file_name(format!(".freeshow-recording-{id}.part"));let file=fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|e|e.to_string())?;sessions.insert(id.clone(),Recording{file,temporary,destination,offset:0});return Ok(json!({"id":id}));}
        let id=data["id"].as_str().ok_or("Missing recording ID")?;
        if operation=="RECORDING_ABORT"{sessions.remove(id);return Ok(Value::Null);}
        if operation=="RECORDING_CHUNK"{let recording=sessions.get_mut(id).ok_or("Recording export not found")?;if data["offset"].as_u64()!=Some(recording.offset){return Err("Recording chunks arrived out of order".into());}let input=data["base64"].as_str().ok_or("Missing recording chunk")?;if input.len()>6*1024*1024{return Err("Recording chunk too large".into());}let bytes=STANDARD.decode(input).map_err(|e|e.to_string())?;recording.file.write_all(&bytes).map_err(|e|e.to_string())?;recording.offset+=bytes.len() as u64;return Ok(json!({"offset":recording.offset}));}
        if operation=="RECORDING_FINISH"{let recording=sessions.remove(id).ok_or("Recording export not found")?;if data["size"].as_u64()!=Some(recording.offset){return Err("Incomplete recording export".into());}recording.file.sync_all().map_err(|e|e.to_string())?;if recording.destination.exists(){return Err("Recording destination already exists".into());}fs::rename(&recording.temporary,&recording.destination).map_err(|e|e.to_string())?;return Ok(json!({"path":recording.destination}));}
        return Err("Unknown recording operation".into());
    }
    if operation=="NOW_PLAYING"{*services.playing.lock().unwrap()=data;return Ok(Value::Null);}
    if operation=="NOW_PLAYING_UNSET"{*services.playing.lock().unwrap()=Value::Null;return Ok(Value::Null);}
    let playing=services.playing.lock().unwrap().clone();let library=library.inner().clone();
    tauri::async_runtime::spawn_blocking(move||{
        match operation.as_str(){
            "SPELLCHECK"=>crate::spelling::check(&data),
            "GET_DEVICE_NAME"=>Ok(json!(crate::platform::device_name()?)),
            "GET_PATHS"=>Ok(json!({"pictures":app.path().picture_dir().map_err(|e|e.to_string())?,"videos":app.path().video_dir().map_err(|e|e.to_string())?,"music":app.path().audio_dir().map_err(|e|e.to_string())?})),
            "GET_GRAPHICS_DEVICES"=>Ok(json!([])), // Original Windows backend also offers no persistable GPU selector.
            "CHECK_RAM_USAGE"=>crate::platform::memory(),
            "GET_STORE_VALUE"|"SET_STORE_VALUE"=>{let path=store_path(&app,&library,data["file"].as_str().ok_or("Missing store")?)?;let key=data["key"].as_str().ok_or("Missing key")?;let _guard=library.write_lock.lock().unwrap();let mut value=load(path.clone())?;if operation=="GET_STORE_VALUE"{return Ok(get_key(&value,key));}set_key(&mut value,key,data["value"].clone())?;write_json(path,&value)?;Ok(Value::Null)},
            "SET_MEDIA_FOLDER_PATH"=>{let path=absolute(&data,"path")?;fs::create_dir_all(&path).map_err(|e|e.to_string())?;let target=store_path(&app,&library,"config")?;let _guard=library.write_lock.lock().unwrap();let mut value=load(target.clone())?;value["mediaFolderPath"]=json!(path);write_json(target,&value)?;Ok(json!(path))},
            "GET_MEDIA_FOLDER_PATH"=>Ok(json!(media_folder(&app,&library)?)),
            "OPEN_LOG"|"OPEN_CACHE"|"OPEN_APPDATA"|"OPEN_NOW_PLAYING"|"SYSTEM_OPEN"=>{
                let path=match operation.as_str(){"OPEN_APPDATA"=>app.path().app_local_data_dir().map_err(|e|e.to_string())?,"OPEN_CACHE"=>library.root.join("cache"),"OPEN_LOG"=>app.path().app_local_data_dir().map_err(|e|e.to_string())?.join("logs"),"OPEN_NOW_PLAYING"=>PathBuf::from(playing["filePath"].as_str().ok_or("No media is playing")?).parent().ok_or("Missing media folder")?.to_owned(),_=>absolute(&data,"path")?};
                if operation!="SYSTEM_OPEN"{fs::create_dir_all(&path).map_err(|e|e.to_string())?;}crate::platform::open_target(path,false)?;Ok(Value::Null)
            },
            "LOG"|"LOG_ERROR"=>{let dir=app.path().app_local_data_dir().map_err(|e|e.to_string())?.join("logs");fs::create_dir_all(&dir).map_err(|e|e.to_string())?;let text=serde_json::to_string(&data).map_err(|e|e.to_string())?;if text.len()>65536{return Err("Log entry too large".into());}let p=dir.join("application.log");if fs::metadata(&p).is_ok_and(|m|m.len()>4*1024*1024){fs::rename(&p,dir.join("previous.log")).map_err(|e|e.to_string())?;}let mut f=fs::OpenOptions::new().create(true).append(true).open(p).map_err(|e|e.to_string())?;writeln!(f,"{text}").map_err(|e|e.to_string())?;Ok(Value::Null)},
            "READ_BINARY"=>{let path=absolute(&data,"path")?;let mut f=fs::File::open(path).map_err(|e|e.to_string())?;let size=f.metadata().map_err(|e|e.to_string())?.len();let offset=data["offset"].as_u64().unwrap_or(0);let count=data["length"].as_u64().unwrap_or(1024*1024).min(1024*1024);f.seek(SeekFrom::Start(offset)).map_err(|e|e.to_string())?;let mut bytes=Vec::new();f.take(count).read_to_end(&mut bytes).map_err(|e|e.to_string())?;Ok(json!({"base64":STANDARD.encode(&bytes),"size":size,"eof":offset+bytes.len() as u64>=size}))},
            "SAVE_IMAGE"|"RECORDER"=>{let encoded=data["base64"].as_str().ok_or("Missing image or recording data")?;if encoded.len()>90*1024*1024{return Err("Recording chunk is too large".into());}let encoded=encoded.split_once(',').map(|v|v.1).unwrap_or(encoded);let bytes=STANDARD.decode(encoded).map_err(|e|e.to_string())?;let bytes=if operation=="SAVE_IMAGE"{export_image(bytes,data["format"].as_str().unwrap_or("png"))?}else{bytes};let folder=library.root.join("Exports");let path=if let Some(parts)=data["filePath"].as_array(){let mut path=folder.clone();for part in parts{let name=part.as_str().ok_or("Invalid export path")?;if name=="."||name==".."{return Err("Invalid export folder".into());}path.push(crate::library_services::file_name(name));}path}else if data["path"].as_str().is_some(){absolute(&data,"path")?}else{folder.join(crate::library_services::file_name(data["name"].as_str().unwrap_or("Recording.webm")))};fs::create_dir_all(path.parent().ok_or("Missing parent folder")?).map_err(|e|e.to_string())?;fs::write(&path,bytes).map_err(|e|e.to_string())?;Ok(json!({"path":path,"id":data["id"]}))},
            "MEDIA_FOLDER_COPY"=>{let folder=media_folder(&app,&library)?;let mut files=Vec::new();for value in data["paths"].as_array().ok_or("Missing media paths")?{let source=PathBuf::from(value.as_str().ok_or("Invalid media path")?);if !source.is_absolute(){return Err("Absolute media path required".into());}files.push(copied_file(&source,&folder)?);}Ok(json!({"files":files}))},
            "REFRESH_SHOWS"=>crate::index_folder(&library.root),
            "GET_EMPTY_SHOWS"=>{let index=crate::index_folder(&library.root)?;let mut empty=Vec::new();for id in index.as_object().ok_or("Invalid show index")?.keys(){let stored=load(library.show_path(id)?)?;let show=if data["cached"][id].is_object(){&data["cached"][id]}else{&stored[1]};if !show_has_content(show){empty.push(json!({"id":id,"name":index[id]["name"]}));}}Ok(json!(empty))},
            "DELETE_SHOWS"|"DELETE_SHOWS_NI"=>{let _guard=library.write_lock.lock().unwrap();let index=crate::index_folder(&library.root)?;let mut ids=Vec::new();if operation=="DELETE_SHOWS"{for show in data["shows"].as_array().ok_or("Missing shows")?{ids.push(show["id"].as_str().ok_or("Missing show ID")?.to_string());}}else{for id in index.as_object().ok_or("Invalid show index")?.keys(){if data["shows"].get(id).is_none(){ids.push(id.clone());}}}let trash=library.root.join("Trash").join("Shows").join(uuid::Uuid::new_v4().to_string());fs::create_dir_all(&trash).map_err(|e|e.to_string())?;let mut deleted=Vec::new();for id in ids{let path=library.show_path(&id)?;if path.is_file(){let name=path.file_name().ok_or("Invalid show path")?.to_owned();fs::rename(&path,trash.join(&name)).map_err(|e|e.to_string())?;deleted.push(name.to_string_lossy().to_string());}}Ok(json!({"deleted":deleted}))},
            "FFMPEG_CHECK"=>Ok(match tool(&app,"ffmpeg"){Ok(path)=>json!({"installed":true,"path":path}),Err(_)=>json!({"installed":false})}),
            "MEDIA_PROBE"=>inspect(&app,&absolute(&data,"path")?),
            "EMIT_OSC"=>{let signal=&data["signal"];let host=signal["host"].as_str().unwrap_or("127.0.0.1");let port=signal["port"].as_u64().unwrap_or(8080);if port==0||port>65535{return Err("Invalid OSC port".into());}let mut parts=data["data"].as_str().ok_or("Missing OSC message")?.split_whitespace();let address=parts.next().ok_or("Missing OSC address")?;if !address.starts_with('/') {return Err("OSC addresses start with /".into());}let args=parts.map(|s|{if let Ok(i)=s.parse::<i32>(){rosc::OscType::Int(i)}else if let Ok(f)=s.parse::<f32>(){rosc::OscType::Float(f)}else{rosc::OscType::String(s.into())}}).collect();let bytes=rosc::encoder::encode(&rosc::OscPacket::Message(rosc::OscMessage{addr:address.into(),args})).map_err(|e|e.to_string())?;std::net::UdpSocket::bind("0.0.0.0:0").map_err(|e|e.to_string())?.send_to(&bytes,(host,port as u16)).map_err(|e|e.to_string())?;Ok(Value::Null)},
            _=>Err(format!("Unknown desktop service: {operation}"))
        }
    }).await.map_err(|e|e.to_string())?
}

#[cfg(test)] mod tests {use super::*;
    #[test]fn image_export_converts_format(){let image=image::DynamicImage::new_rgb8(4,3);let mut bytes=std::io::Cursor::new(Vec::new());image.write_to(&mut bytes,image::ImageFormat::Jpeg).unwrap();let png=export_image(bytes.into_inner(),"png").unwrap();assert!(png.starts_with(b"\x89PNG"));assert_eq!(image::load_from_memory(&png).unwrap().width(),4);}
    #[test]fn empty_show_detection_preserves_layouts_and_text(){assert!(show_has_content(&json!({"layouts":{"a":{"slides":[{}]}}})));assert!(show_has_content(&json!({"slides":{"a":{"items":[{"lines":[{"text":[{"value":"hello"}]}]}]}}})));assert!(!show_has_content(&json!({"slides":{"a":{"items":[{"lines":[{"text":[{"value":""}]}]}]}}})));}
    #[test]fn nested_settings_round_trip_and_reject_invalid_keys(){let mut value=json!({});set_key(&mut value,"midi.channel",json!(2)).unwrap();assert_eq!(get_key(&value,"midi.channel"),2);assert!(set_key(&mut value,"__proto__.x",json!(3)).is_err());}
    #[test]fn copied_media_preserves_existing_files(){let root=std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());fs::create_dir_all(&root).unwrap();let source=root.join("video.mp4");fs::write(&source,b"new").unwrap();let dest=root.join("Media");fs::create_dir_all(&dest).unwrap();fs::write(dest.join("video.mp4"),b"original").unwrap();let copied=copied_file(&source,&dest).unwrap();assert_ne!(copied,dest.join("video.mp4"));assert_eq!(fs::read(dest.join("video.mp4")).unwrap(),b"original");fs::remove_dir_all(root).unwrap();}
}
