#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::{json, Map, Value};
use std::{fs, path::PathBuf, sync::{Arc, Mutex}};
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
#[cfg(windows)] mod native_capture;
#[cfg(not(windows))] #[path="mac/native_capture.rs"] mod native_capture;
#[cfg(windows)] mod virtual_camera;
#[cfg(not(windows))] #[path="mac/virtual_camera.rs"] mod virtual_camera;
mod media_files;
mod library_services;
mod spotify;
mod backups;
mod packages;
mod powerpoint;
mod file_drop;
mod output_geometry;
mod output_safety;
#[cfg(windows)] mod output_engines;
#[cfg(not(windows))] #[path="mac/output_engines.rs"] mod output_engines;
mod slide_capture;
mod pdf_export;
mod screen_identify;
#[tauri::command]
async fn exit_fullscreen(caller: tauri::Webview) -> Result<(), String> {
    let window = caller.window();
    if window.label().starts_with("output-") {
        output_safety::dismiss_output_and_blockers(&window)?;
    } else if window.label() == "main" {
        output_safety::dismiss_blocking(window.app_handle(), false);
        if window.is_fullscreen().map_err(|e| e.to_string())? { window.set_fullscreen(false).map_err(|e| e.to_string())?; }
    } else if window.is_fullscreen().map_err(|e| e.to_string())? {
        window.set_fullscreen(false).map_err(|e| e.to_string())?;
    }
    Ok(())
}
mod local_servers;
mod phone_camera;
#[cfg(windows)] mod rtmp_input;
#[cfg(not(windows))] #[path="mac/rtmp_input.rs"] mod rtmp_input;
mod desktop_services;
mod platform;
mod spelling;
#[cfg(windows)] mod midi;
#[cfg(not(windows))] #[path="mac/midi.rs"] mod midi;
mod backend_runtime;
mod remote;
mod websites;
mod shared_websites;
use native_capture::{
    native_capture_frame, native_capture_start, native_capture_stop, native_sources,
    native_thumbnail, native_capture_browser, NativeCapture,
};

#[derive(Clone)]
struct Library {
    root: PathBuf,
    write_lock: Arc<Mutex<()>>,
}
impl Library {
    fn show_path(&self, id: &str) -> Result<PathBuf, String> {
        safe_id(id)?;
        let folder = self.root.join("Shows");
        if self.root.join("Config").is_dir() {
            for entry in fs::read_dir(&folder).map_err(|e| e.to_string())? {
                let path = entry.map_err(|e| e.to_string())?.path();
                if path.extension().and_then(|s| s.to_str()) == Some("show")
                    && load(path.clone()).ok().and_then(|v| v.get(0).and_then(Value::as_str).map(str::to_owned)).as_deref() == Some(id)
                {
                    return Ok(path);
                }
            }
        }
        Ok(folder.join(format!("{id}.show")))
    }
    fn store_path(&self, key: &str) -> PathBuf {
        if !self.root.join("Config").is_dir() {
            return self.root.join(format!("{key}.json"));
        }
        let name = match key {
            "SYNCED_SETTINGS" => "settings_synced".into(),
            "SETTINGS" => "settings_tauri".into(),
            _ => key.to_lowercase(),
        };
        self.root.join("Config").join(format!("{name}.json"))
    }
}
#[tauri::command]
async fn pick_folder(
    window: tauri::Window,
    title: String,
    path: Option<String>,
) -> Result<Option<String>, String> {
    if window.label() != "main" {
        return Err("Main window only".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = rfd::FileDialog::new().set_title(title).set_parent(&window);
        if let Some(path) = path {
            dialog = dialog.set_directory(path);
        }
        dialog
            .pick_folder()
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())
}
#[tauri::command]
fn set_data_folder(
    app: tauri::AppHandle,
    window: tauri::Window,
    path: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Main window only".into());
    }
    let root = PathBuf::from(path);
    if !root.is_absolute() || !root.is_dir() {
        return Err("Choose an existing absolute folder".into());
    }
    let probe = root.join(format!(".freeshow-write-test-{}", std::process::id()));
    drop(
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe)
            .map_err(|e| e.to_string())?,
    );
    fs::remove_file(probe).map_err(|e| e.to_string())?;
    write_json(
        app.path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("library-location.json"),
        &json!({"path": root}),
    )
}
#[tauri::command]
fn open_folder_path(window: tauri::Window, path: String) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Main window only".into());
    }
    if !PathBuf::from(&path).is_dir() {
        return Err("Folder does not exist".into());
    }
    platform::open_target(path,false)?;
    Ok(())
}
const STORES: &[&str] = &[
    "SETTINGS",
    "SYNCED_SETTINGS",
    "STAGE",
    "PROJECTS",
    "OVERLAYS",
    "TEMPLATES",
    "EVENTS",
    "MEDIA",
    "THEMES",
    "DRIVE_API_KEY",
    "HISTORY",
    "CACHE",
    "USAGE",
];

fn load(path: PathBuf) -> Result<Value, String> {
    match fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| format!("{}: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(e) => Err(e.to_string()),
    }
}
fn safe_id(id: &str) -> Result<&str, String> {
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Invalid show identifier".into());
    }
    Ok(id)
}
fn write_json(path: PathBuf, data: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec(data).map_err(|e| e.to_string())?;
    let temp = path.with_extension("tmp");
    fs::write(&temp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&temp, path).map_err(|e| e.to_string())
}
fn commit_library(library: &Library, writes: Vec<(PathBuf, Value)>, deleted: Vec<PathBuf>) -> Result<(), String> {
    let staging = library.root.join("cache").join(format!("save-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&staging).map_err(|e|e.to_string())?;
    let mut originals = Vec::<(PathBuf, Option<PathBuf>)>::new();
    let result = (|| {
        for (i, path) in writes.iter().map(|(p,_)|p).chain(deleted.iter()).enumerate() {
            if !path.starts_with(&library.root) { return Err("Save path outside library".into()); }
            let original = if path.exists() {
                let backup = staging.join(format!("{i}.original"));
                fs::copy(path,&backup).map_err(|e|e.to_string())?;
                Some(backup)
            } else { None };
            originals.push((path.clone(), original));
        }
        for (i, (_, data)) in writes.iter().enumerate() {
            let staged=staging.join(format!("{i}.new"));
            fs::write(staged, serde_json::to_vec(data).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
        }
        let apply = (|| {
            for (i, (path,_)) in writes.iter().enumerate() {
                fs::create_dir_all(path.parent().ok_or("Invalid save destination")?).map_err(|e|e.to_string())?;
                fs::rename(staging.join(format!("{i}.new")),path).map_err(|e|e.to_string())?;
            }
            for path in &deleted { if path.exists() { fs::remove_file(path).map_err(|e|e.to_string())?; } }
            Ok::<(),String>(())
        })();
        if let Err(error)=apply {
            let mut rollback_errors=Vec::new();
            for (path, original) in &originals {
                let result=match original { Some(original)=>fs::copy(original,path).map(|_|()), None if path.is_file()=>fs::remove_file(path), None=>Ok(()) };
                if let Err(error)=result { rollback_errors.push(format!("{}: {error}",path.display())); }
            }
            if !rollback_errors.is_empty() { return Err(format!("{error}. Recovery files kept at {}. Rollback errors: {}",staging.display(),rollback_errors.join(", "))); }
            return Err(error);
        }
        Ok(())
    })();
    // Preserve recovery copies only when automatic rollback failed.
    if !result.as_ref().err().is_some_and(|e|e.contains("Recovery files kept")) { let _=fs::remove_dir_all(staging); }
    result
}
fn restore_media_assets(library: &Library) -> Result<(), String> {
    let pending=library.root.join("pending-media-recovery.json");
    if !pending.is_file(){return Ok(());}
    let recovery=load(pending.clone())?;
    let backups=library.root.join("Asset Recovery Backups").join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&backups).map_err(|e|e.to_string())?;
    for key in ["OVERLAYS","TEMPLATES","STAGE","MEDIA","SETTINGS","SYNCED_SETTINGS"] {
        let path=library.store_path(key);
        let mut current=load(path.clone())?;
        let incoming=if key=="SETTINGS" {&recovery["settings"]} else {&recovery[key]};
        if !incoming.is_object(){continue;}
        if path.is_file(){fs::copy(&path,backups.join(format!("{key}.json"))).map_err(|e|e.to_string())?;}
        if key.ends_with("SETTINGS") {
            let fields: &[&str]=if key=="SETTINGS" { &["mediaFolders","audioFolders"] } else { &["overlayCategories","templateCategories","categories","scriptures","styles","effects","timers","timerTags","audioPlaylists","audioStreams"] };
            for field in fields {
                if !current[field].is_object(){current[field]=json!({});}
                merge_missing(current[field].as_object_mut().unwrap(), &incoming[field]);
            }
        } else {
            if !current.is_object(){return Err(format!("Invalid {key} store"));}
            merge_missing(current.as_object_mut().unwrap(), incoming);
        }
        write_json(path,&current)?;
    }
    fs::rename(pending,backups.join("recovery.json")).map_err(|e|e.to_string())?;
    Ok(())
}
fn merge_missing(current: &mut Map<String,Value>, incoming: &Value) {
    if let Some(incoming)=incoming.as_object(){for (id,value) in incoming {current.entry(id.clone()).or_insert_with(||value.clone());}}
}
#[tauri::command]
fn read_store(key: String, library: State<Library>) -> Result<Value, String> {
    if !STORES.contains(&key.as_str()) {
        return Err("Unknown store".into());
    }
    load(library.store_path(&key))
}
#[tauri::command]
fn show_index(app: tauri::AppHandle, library: State<Library>) -> Result<Value, String> {
    if library.root.join("Config").is_dir() {
        let mut invalid = Vec::new();
        for entry in fs::read_dir(library.root.join("Shows")).map_err(|e|e.to_string())? {
            let path=entry.map_err(|e|e.to_string())?.path();
            if path.extension().and_then(|s|s.to_str())==Some("show") {
                match load(path.clone()) {
                    Ok(value) if value[0].as_str().is_some_and(|id|safe_id(id).is_ok()) && value[1].is_object() => {},
                    _ => invalid.push(path.file_name().unwrap_or_default().to_string_lossy().into_owned())
                }
            }
        }
        if !invalid.is_empty() {
            let _=app.emit_to("main","freeshow-ipc",json!({"channel":"MAIN","msg":{"channel":"ALERT","data":format!("Skipped {} unreadable show file(s). Other shows remain available.\n{}", invalid.len(),invalid.join("\n"))}}));
        }
        return index_folder(&library.root);
    }
    load(library.root.join("show-index.json"))
}
fn index_folder(root: &PathBuf) -> Result<Value, String> {
    let mut index = Map::new();
    for entry in fs::read_dir(root.join("Shows")).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|s| s.to_str()) != Some("show") {
            continue;
        }
        let content = match load(path.clone()) {
            Ok(content) => content,
            Err(error) => { eprintln!("Skipped unreadable show: {error}"); continue; }
        };
        if let (Some(id), Some(show)) = (
            content.get(0).and_then(Value::as_str),
            content.get(1).and_then(Value::as_object),
        ) {
            if safe_id(id).is_err() { eprintln!("Skipped invalid show identifier in {}", path.display()); continue; }
            let metadata: Map<String, Value> = [
                "name",
                "category",
                "timestamps",
                "quickAccess",
                "private",
                "locked",
            ]
            .iter()
            .filter_map(|key| show.get(*key).map(|v| ((*key).to_string(), v.clone())))
            .collect();
            index.insert(id.into(), Value::Object(metadata));
        }
    }
    Ok(Value::Object(index))
}
#[tauri::command]
fn read_show(id: String, library: State<Library>) -> Result<Value, String> {
    let path = library.show_path(&id)?;
    if !path.exists() {
        return Ok(json!({"id":id,"error":"not_found"}));
    }
    let content = load(path)?;
    let content = if content.is_array() {
        content
    } else {
        json!([id, content])
    };
    Ok(json!({"id": id, "content": content}))
}
#[tauri::command]
async fn save_library(caller: tauri::Webview, data: Value, library: State<'_, Library>) -> Result<Value, String> {
    if caller.label() != "main" || caller.label() != caller.window().label() { return Err("Save from the editor".into()); }
    let library = library.inner().clone();
    tauri::async_runtime::spawn_blocking(move || write_save(data, &library)).await.map_err(|e|e.to_string())?
}

fn write_save(data: Value, library: &Library) -> Result<Value, String> {
    let _guard = library.write_lock.lock().map_err(|e| e.to_string())?;
    let obj = data.as_object().ok_or("Expected save object")?;
    // Validate identifiers before writing any data.
    if let Some(bibles) = data.get("scripturesCache").and_then(Value::as_object) {
        for id in bibles.keys() { safe_id(id)?; }
    }
    if let Some(shows) = data.get("showsCache").and_then(Value::as_object) {
        for id in shows.keys() {
            safe_id(id)?;
        }
    }
    if let Some(deleted) = data.get("deletedShows").and_then(Value::as_array) {
        for show in deleted {
            if let Some(id) = show.get("id").and_then(Value::as_str) {
                safe_id(id)?;
            }
        }
    }
    let mut writes = Vec::new();
    let mut deleted_paths = Vec::new();
    for key in STORES {
        if let Some(value) = obj.get(*key) {
            writes.push((library.store_path(key), value.clone()));
        }
    }
    if let Some(bibles) = data.get("scripturesCache").and_then(Value::as_object) {
        let folder=library.root.join("Bibles");
        fs::create_dir_all(&folder).map_err(|e|e.to_string())?;
        for (id,content) in bibles { if content.is_object() { writes.push((library_services::bible_store_path(&folder,id)?,json!([id,content]))); } }
    }
    if let Some(shows) = data.get("showsCache").and_then(Value::as_object) {
        for (id, show) in shows {
            writes.push((library.show_path(id)?, json!([id, show])));
        }
    }
    if let Some(shows) = data
        .get("SHOWS")
        .filter(|_| !library.root.join("Config").is_dir())
    {
        writes.push((library.root.join("show-index.json"), shows.clone()));
    }
    if let Some(deleted) = data.get("deletedShows").and_then(Value::as_array) {
        for show in deleted {
            if let Some(id) = show.get("id").and_then(Value::as_str) {
                safe_id(id)?;
                if data.get("showsCache").and_then(|v| v.get(id)).is_some() {
                    continue;
                }
                let path = library.show_path(id)?;
                deleted_paths.push(path);
            }
        }
    }
    // A reset must have its own completed safety backup; a timer from the
    // reset popup must never be treated as proof that an earlier backup worked.
    if data["customTriggers"]["reset"].as_bool() == Some(true) { backups::create(library, false)?; }
    commit_library(library, writes, deleted_paths)?;
    let backup_path = if data["customTriggers"]["backup"].as_bool() == Some(true) {
        Some(backups::create(library, data["customTriggers"]["isAutoBackup"].as_bool() == Some(true))?)
    } else { None };
    if backup_path.is_some() {
        let mut settings = load(library.store_path("SETTINGS"))?;
        let timestamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
        settings["special"]["autoBackupPrevious"] = json!(timestamp.saturating_sub(3600000));
        write_json(library.store_path("SETTINGS"), &settings)?;
    }
    Ok(json!({"backupPath":backup_path}))
}
#[tauri::command]
fn app_info(key: String, library: State<Library>) -> Result<Value, String> {
    Ok(match key.as_str() {
        "VERSION" => json!(env!("CARGO_PKG_VERSION")),
        "IS_DEV" => json!(cfg!(debug_assertions)),
        "GET_OS" => {
            json!({"platform": if cfg!(target_os="windows") { "win32" } else if cfg!(target_os="macos") { "darwin" } else { "linux" }, "name": std::env::consts::OS, "arch": std::env::consts::ARCH})
        }
        "GET_CACHE_PATH" => json!(library.root.join("cache").to_string_lossy()),
        "DATA_PATH" => json!(library.root.to_string_lossy()),
        // The prototype has no migrated device identity or analytics service.
        "DEVICE_ID" => json!(""),
        _ => return Err("Unknown app info".into()),
    })
}
#[tauri::command]
fn window_action(action: String, window: tauri::Window) -> Result<Value, String> {
    match action.as_str() {
        "IS_FULLSCREEN" => {
            return window
                .is_fullscreen()
                .map(|value| json!(value))
                .map_err(|e| e.to_string())
        }
        // This command is sent only after renderer save/discard completion.
        "CLOSE" => window.destroy().map_err(|e| e.to_string())?,
        "MINIMIZE" => window.minimize().map_err(|e| e.to_string())?,
        "MAXIMIZE" => {
            if window.is_maximized().map_err(|e| e.to_string())? {
                window.unmaximize()
            } else {
                window.maximize()
            }
            .map_err(|e| e.to_string())?;
        }
        "MAXIMIZED" => {
            return window
                .is_maximized()
                .map(|v| json!(v))
                .map_err(|e| e.to_string())
        }
        "FULLSCREEN" => {
            let fullscreen = !window.is_fullscreen().map_err(|e| e.to_string())?;
            if fullscreen { output_safety::editor_fullscreen_policy(&window, true); }
            window.set_fullscreen(fullscreen).map_err(|e| e.to_string())?;
            if !fullscreen { output_safety::editor_fullscreen_policy(&window, false); }
        },
        "DRAG" => window.start_dragging().map_err(|e| e.to_string())?,
        "GET_DISPLAYS" => {
            let monitors = window.available_monitors().map_err(|e| e.to_string())?;
            return Ok(Value::Array(monitors.iter().enumerate().map(|(i,m)| {
                let p=m.position(); let s=m.size(); let scale=m.scale_factor();
                json!({"id":i+1,"label":m.name(),"internal":i==0,"scaleFactor":scale,"bounds":{"x":p.x as f64/scale,"y":p.y as f64/scale,"width":s.width as f64/scale,"height":s.height as f64/scale},"size":{"width":s.width as f64/scale,"height":s.height as f64/scale}})
            }).collect()));
        }
        _ => return Err("Unknown window action".into()),
    }
    Ok(Value::Null)
}
fn output_label(id: &str) -> String {
    format!("output-{id}")
}
fn create_output(app: &tauri::AppHandle, output: &Value) -> Result<tauri::Window, String> {
    let id = output
        .get("id")
        .and_then(Value::as_str)
        .ok_or("Output ID missing")?;
    safe_id(id)?;
    let label = output_label(id);
    if let Some(window) = app.get_window(&label) {
        return Ok(window);
    }
    let bounds = &output["bounds"];
    WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title(format!("FreeShow Output — {id}"))
        .decorations(false)
        .shadow(false)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .background_color(tauri::window::Color(0, 0, 0, 255))
        .inner_size(
            bounds["width"].as_f64().unwrap_or(1280.0),
            bounds["height"].as_f64().unwrap_or(720.0),
        )
        .position(
            bounds["x"].as_f64().unwrap_or(0.0),
            bounds["y"].as_f64().unwrap_or(0.0),
        )
        .build()
        .map(|webview| webview.as_ref().window())
        .map_err(|e| e.to_string())
}
fn position_output(
    w: &tauri::Window,
    output: &Value,
    auto: bool,
    app: &tauri::AppHandle,
) -> Result<(), String> {
    use output_geometry::{Display, Rect};
    // Camera/network-only outputs still need a live compositor surface for capture,
    // but must never cover a physical display or take keyboard focus.
    if output["virtualCamera"].as_bool().unwrap_or(false) || output["invisible"].as_bool().unwrap_or(false) {
        let monitors = w.available_monitors().map_err(|e| e.to_string())?;
        let right = monitors.iter().map(|m| m.position().x as i64 + m.size().width as i64).max().unwrap_or(1920);
        w.set_always_on_top(false).map_err(|e| e.to_string())?;
        w.set_position(tauri::PhysicalPosition::new((right + 64).min(i32::MAX as i64) as i32, 0)).map_err(|e| e.to_string())?;
        w.set_size(tauri::PhysicalSize::new(1280u32, 720u32)).map_err(|e| e.to_string())?;
        return Ok(());
    }
    let monitors = w.available_monitors().map_err(|e| e.to_string())?;
    let displays = monitors
        .iter()
        .map(|m| Display {
            physical: Rect {
                x: m.position().x as f64,
                y: m.position().y as f64,
                width: m.size().width as f64,
                height: m.size().height as f64,
            },
            scale: m.scale_factor(),
        })
        .collect::<Vec<_>>();
    let editor = app
        .get_window("main")
        .and_then(|main| main.current_monitor().ok().flatten());
    let editor_index = editor.and_then(|editor| {
        monitors
            .iter()
            .position(|m| m.position() == editor.position())
    });
    let b = &output["bounds"];
    let requested = Rect {
        x: b["x"].as_f64().unwrap_or(0.0),
        y: b["y"].as_f64().unwrap_or(0.0),
        width: b["width"].as_f64().unwrap_or(1280.0),
        height: b["height"].as_f64().unwrap_or(720.0),
    };
    let selected = output["screen"]
        .as_str()
        .and_then(|id| id.parse::<usize>().ok())
        .map(|id| id.saturating_sub(1));
    let bounds = output_geometry::resolve(
        &displays,
        requested,
        selected,
        auto,
        output["boundsLocked"].as_bool().unwrap_or(false),
        editor_index,
    );
    w.set_position(tauri::PhysicalPosition::new(
        bounds.x.round() as i32,
        bounds.y.round() as i32,
    ))
    .map_err(|e| e.to_string())?;
    w.set_size(tauri::PhysicalSize::new(
        bounds.width.round().max(1.0) as u32,
        bounds.height.round().max(1.0) as u32,
    ))
    .map_err(|e| e.to_string())?;
    w.set_always_on_top(output["alwaysOnTop"].as_bool().unwrap_or(true))
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
async fn output_message(
    msg: Value,
    window: tauri::Window,
    app: tauri::AppHandle,
    caller:tauri::Webview,
) -> Result<(), String> {
    if caller.label()!=window.label(){return Err("Output control requires a FreeShow render window".into());}
    let channel = msg["channel"].as_str().ok_or("Missing output channel")?;
    let data = &msg["data"];
    if window.label() != "main" {
        if let Some(main) = app.get_window("main") {
            main.emit_to(
                "main",
                "freeshow-ipc",
                json!({"channel":"OUTPUT","msg":msg}),
            )
            .map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    match channel {
        // The editor keeps the output configuration. Create a webview only when it is enabled.
        "CREATE" => return Ok(()),
        "REMOVE" => {
            if let Some(id) = data["id"].as_str() {
                output_engines::configure(&app,&json!({"id":id}),false).await?;
                if let Some(w) = app.get_window(&output_label(id)) {
                    w.close().map_err(|e| e.to_string())?;
                }
            }
            return Ok(());
        }
        "TOGGLE_OUTPUTS" => {
            let mut states = Vec::new();
            if let Some(outputs) = data["outputs"].as_array() {
                for output in outputs {
                    let visible = data["state"].as_bool().unwrap_or(false);
                    if visible {
                        let w = create_output(&app, output)?;
                        position_output(
                            &w,
                            output,
                            data["autoPosition"].as_bool().unwrap_or(false),
                            &app,
                        )?;
                        w.show().map_err(|e| e.to_string())?;
                        output_engines::configure(&app,output,true).await?;
                    } else if let Some(id) = output["id"].as_str() {
                        output_engines::configure(&app,&json!({"id":id}),false).await?;
                        if let Some(w) = app.get_window(&output_label(id)) {
                            w.close().map_err(|e| e.to_string())?;
                        }
                    }
                    states.push(json!({"id":output["id"],"active":visible}));
                }
            }
            window
                .emit_to(
                    window.label(),
                    "freeshow-ipc",
                    json!({"channel":"OUTPUT","msg":{"channel":"OUTPUT_STATE","data":states}}),
                )
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
        "UPDATE_BOUNDS" => {
            if let Some(id) = data["id"].as_str() {
                if let Some(w) = app.get_window(&output_label(id)) {
                    position_output(&w, data, false, &app)?;
                }
            }
            return Ok(());
        }
        "MOVE" => return Ok(()),
        "SET_VALUE" => {
            if let Some(id) = data["id"].as_str() {
                if let Some(w) = app.get_window(&output_label(id)) {
                    match data["key"].as_str() {
                        Some("alwaysOnTop") => w
                            .set_always_on_top(data["value"].as_bool().unwrap_or(false))
                            .map_err(|e| e.to_string())?,
                        Some("name") => w
                            .set_title(data["value"].as_str().unwrap_or("FreeShow Output"))
                            .map_err(|e| e.to_string())?,
                        Some(key) if ["ndi","ndiData","omt","omtData","blackmagic","blackmagicData","rtmp","rtmpData","webrtc","webrtcData","forcedResolution","invisible","screen","bounds","boundsLocked"].contains(&key) => {
                            if let Some(mut output)=app.state::<output_engines::OutputEngines>().output(id){output[key]=data["value"].clone();if ["forcedResolution","invisible","screen","bounds","boundsLocked"].contains(&key){position_output(&w,&output,false,&app)?;}output_engines::configure(&app,&output,true).await?;}
                        },
                        _ => return Err("This output setting has not been ported yet".into()),
                    }
                }
            }
            return Ok(());
        }
        "FOCUS" | "TO_FRONT" => {
            let id = data["id"]
                .as_str()
                .or_else(|| data.as_str())
                .ok_or("Missing output ID")?;
            if let Some(w) = app.get_window(&output_label(id)) {
                w.set_focus().map_err(|e| e.to_string())?;
            }
            return Ok(());
        }
        "ALIGN_WITH_SCREEN" => {
            for (label, w) in app.windows() {
                if !label.starts_with("output-") {
                    continue;
                }
                if let Some(monitor) = w.current_monitor().map_err(|e| e.to_string())? {
                    w.set_position(*monitor.position())
                        .map_err(|e| e.to_string())?;
                    w.set_size(*monitor.size()).map_err(|e| e.to_string())?;
                    let scale = monitor.scale_factor();
                    let monitors = w.available_monitors().map_err(|e| e.to_string())?;
                    let screen = monitors
                        .iter()
                        .position(|m| m.position() == monitor.position())
                        .unwrap_or(0)
                        + 1;
                    window.emit_to(window.label(), "freeshow-ipc", json!({"channel":"OUTPUT","msg":{"channel":"MOVE","data":{"id":label.trim_start_matches("output-"),"screen":screen.to_string(),"bounds":{"x":monitor.position().x as f64 / scale,"y":monitor.position().y as f64 / scale,"width":monitor.size().width as f64 / scale,"height":monitor.size().height as f64 / scale}}}})).map_err(|e| e.to_string())?;
                }
            }
            return Ok(());
        }
        "CAPTURE"=>{let id=data["id"].as_str().ok_or("Missing output ID")?;if let Some(output)=app.state::<output_engines::OutputEngines>().output(id){if app.get_window(&output_label(id)).is_some()&&!app.state::<output_engines::OutputEngines>().is_capturing(id){output_engines::configure(&app,&output,true).await?;}}return Ok(())},
        "IDENTIFY_SCREENS"=>return screen_identify::identify(&app),
        "REQUEST_PREVIEW"=>{use base64::Engine;let id=data["id"].as_str().ok_or("Missing preview output ID")?;let preview=data["previewId"].as_str().unwrap_or(id).to_string();let target=app.get_window(&output_label(id)).ok_or("Output is not enabled")?;let handle=native_capture::window_handle(&target)?;let bytes=tauri::async_runtime::spawn_blocking(move||{let bytes=native_capture::window_jpeg(handle)?;let image=image::load_from_memory(&bytes).map_err(|e|e.to_string())?.thumbnail(640,360).to_rgba8();Ok::<_,String>((image.width(),image.height(),image.into_raw()))}).await.map_err(|e|e.to_string())??;window.emit_to("main","freeshow-ipc",json!({"channel":"OUTPUT","msg":{"channel":"BUFFER","data":{"id":preview,"time":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64,"size":{"width":bytes.0,"height":bytes.1},"buffer":{"__fsBytes":base64::engine::general_purpose::STANDARD.encode(bytes.2)}}}})).map_err(|e|e.to_string())?;return Ok(())},
        _ => {}
    }
    for (label, w) in app.windows() {
        if !label.starts_with("output-") {
            continue;
        }
        let id = label.trim_start_matches("output-");
        if let Some(target) = data.get("id").and_then(Value::as_str) {
            if target != id {
                continue;
            }
        }
        let mut outgoing = msg.clone();
        if channel == "OUTPUTS" {
            let mut matching = Map::new();
            if let Some(value) = data.get(id) {
                matching.insert(id.to_owned(), value.clone());
            }
            outgoing["data"] = Value::Object(matching);
            if let Some(snapshot)=app.state::<slide_capture::SlideCapture>().output(id){outgoing["data"]=snapshot;}
        }
        w.emit_to(
            w.label(),
            "freeshow-ipc",
            json!({"channel":"OUTPUT","msg":outgoing}),
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn main() {
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("freeshow-protected", |context, request, responder| {
            let app=context.app_handle().clone();let label=context.webview_label().to_string();
            tauri::async_runtime::spawn(async move {
                let result=backend_runtime::protected_media(&app,&label,request).await;
                let response=result.unwrap_or_else(|_|tauri::http::Response::builder().status(403).body(Vec::new()).unwrap());
                responder.respond(response);
            });
        })
        .manage(NativeCapture::default())
        .manage(virtual_camera::VirtualCamera::default())
        .manage(websites::WebsiteFollowers::default())
        .manage(shared_websites::SharedWebsites::default())
        .manage(file_drop::DropFiles::default())
        .manage(phone_camera::PhoneCamera::default())
        .manage(rtmp_input::RtmpInput::default())
        .manage(desktop_services::DesktopServices::default())
        .manage(midi::Midi::default())
        .manage(backend_runtime::BackendRuntime::default())
        .manage(output_engines::OutputEngines::default())
        .manage(slide_capture::SlideCapture::default())
        .manage(pdf_export::PdfExports::default())
        .manage(remote::Remote::default())
        .manage(local_servers::LocalServers::default())
        .setup(|app| {
            if let Some(main) = app.get_window("main") { output_safety::editor_fullscreen_policy(&main, false); }
            output_safety::install(app.handle().clone());
            let default_root = app.path().app_data_dir()?;
            fs::create_dir_all(&default_root)?;
            let location =
                load(default_root.join("library-location.json")).map_err(std::io::Error::other)?;
            let custom = location
                .get("path")
                .and_then(Value::as_str)
                .map(PathBuf::from);
            let mut configured_root = custom.clone().unwrap_or(default_root.clone());
            while !configured_root.is_dir() {
                let result = rfd::MessageDialog::new().set_title("FreeShow data folder unavailable")
                    .set_description(format!("The data folder is unavailable:\n{}\n\nYes: retry after reconnecting the drive.\nNo: choose another existing library folder.\nCancel: close FreeShow.", configured_root.display()))
                    .set_buttons(rfd::MessageButtons::YesNoCancel).show();
                match result {
                    rfd::MessageDialogResult::Yes => continue,
                    rfd::MessageDialogResult::No => {
                        if let Some(path) = rfd::FileDialog::new().set_title("Choose FreeShow data folder").pick_folder() {
                            configured_root = path;
                            write_json(default_root.join("library-location.json"), &json!({"path":configured_root})).map_err(std::io::Error::other)?;
                        }
                    }
                    _ => return Err(std::io::Error::other("Data folder recovery cancelled").into()),
                }
            }
            let root = if cfg!(debug_assertions) {
                std::env::var_os("FREESHOW_TAURI_TEST_DATA_DIR")
                    .map(PathBuf::from)
                    .unwrap_or(configured_root)
            } else {
                configured_root
            };
            if root != default_root {
                for folder in [
                    "Shows",
                    "Config",
                    "Audio",
                    "Backups",
                    "Bibles",
                    "Exports",
                    "Graphics Assets",
                    "HTML Slideshow",
                    "Imports",
                    "Media",
                    "Online",
                ] {
                    fs::create_dir_all(root.join(folder))?;
                }
            }
            fs::create_dir_all(root.join("Shows"))?;
            fs::create_dir_all(root.join("cache"))?;
            app.asset_protocol_scope().allow_directory(&root, true)?;
            let library=Library {
                root,
                write_lock: Mutex::new(()).into(),
            };
            restore_media_assets(&library).map_err(std::io::Error::other)?;
            app.manage(library);
            Ok(())
        })
        .invoke_handler({
            let handler: fn(tauri::ipc::Invoke) -> bool = tauri::generate_handler![
                file_drop::dropped_files,
                backups::backup_service,
                exit_fullscreen,
                local_servers::local_server_start,
                local_servers::local_server_stop,
                local_servers::local_server_send,
                local_servers::local_server_data,
                local_servers::local_api_return,
                remote::network_ips,
                remote::remote_start,
                remote::remote_send,
                remote::remote_stop,
                remote::open_url,
                phone_camera::phone_camera_start,
                desktop_services::desktop_service,
                midi::midi_service,
                backend_runtime::backend_service,
                slide_capture::capture_slide,
                pdf_export::pdf_export,
                rtmp_input::rtmp_input_start,
                rtmp_input::rtmp_input_stop,
                rtmp_input::rtmp_input_request,
                phone_camera::phone_camera_signal,
                websites::website_view,
                websites::website_follow,
                shared_websites::shared_website,
                shared_websites::shared_website_frame,
                shared_websites::website_source_fullscreen,
                shared_websites::website_source_activity,
                virtual_camera::virtual_camera,
                spotify::spotify_service,
                pick_folder,
                media_files::media_files,
                media_files::pick_media_files,
                library_services::library_service,
                library_services::export_library,
                powerpoint::import_powerpoint,
                powerpoint::document_pdf,
                set_data_folder,
                open_folder_path,
                read_store,
                show_index,
                read_show,
                save_library,
                app_info,
                window_action,
                output_message,
                native_sources,
                native_capture_browser,
                native_thumbnail,
                native_capture_start,
                native_capture_frame,
                native_capture_stop
            ];
            move |invoke: tauri::ipc::Invoke| {
                let view = invoke.message.webview();
                if view.label() != view.window().label()
                    && invoke.message.command() != "exit_fullscreen"
                    && invoke.message.command() != "website_follow"
                {
                    invoke
                        .resolver
                        .reject("Website pages cannot access FreeShow commands");
                    return true;
                }
                handler(invoke)
            }
        })
        .on_window_event(|window, event| {
            if window.label().starts_with("website-source-") {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                    shared_websites::hide_controls(window.app_handle().clone(),window.label().into());
                }
            }
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.emit_to("main", "freeshow-ipc", json!({"channel":"MAIN","msg":{"channel":"CLOSE"}}));
                }
            }
            if matches!(event, tauri::WindowEvent::Destroyed) {
                shared_websites::close_window(window.app_handle().clone(),window.label().into());
                window.state::<NativeCapture>().close_window(window.label());
                window
                    .state::<phone_camera::PhoneCamera>()
                    .close_window(window.label());
            }
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.state::<rtmp_input::RtmpInput>().stop();
                window.state::<midi::Midi>().stop();
                window.state::<backend_runtime::BackendRuntime>().stop();
                window.state::<output_engines::OutputEngines>().stop_all();
                window.app_handle().exit(0);
            }
            if window.label().starts_with("output-")&&matches!(event,tauri::WindowEvent::Destroyed){
                let app=window.app_handle().clone();let id=window.label().trim_start_matches("output-").to_string();
                let _ = app.emit_to("main", "freeshow-ipc", json!({"channel":"OUTPUT","msg":{"channel":"OUTPUT_STATE","data":[{"id":id,"active":false}]}}));
                tauri::async_runtime::spawn(async move{let _=output_engines::configure(&app,&json!({"id":id}),false).await;});
            }
            if window.label().starts_with("pdf-")&&matches!(event,tauri::WindowEvent::Destroyed){window.state::<pdf_export::PdfExports>().remove(window.label());}
        })
        .run(tauri::generate_context!())
        .expect("Failed to run FreeShow Tauri preview");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn malformed_show_does_not_block_valid_index_lookup_or_save() {
        let root=std::env::temp_dir().join(format!("freeshow-corrupt-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("Config")).unwrap();fs::create_dir_all(root.join("Shows")).unwrap();
        let library=Library{root:root.clone(),write_lock:Mutex::new(()).into()};
        fs::write(root.join("Shows/broken.show"),b"invalid json").unwrap();
        write_json(root.join("Shows/Good.show"),&json!(["good",{"name":"Good"}])).unwrap();
        assert_eq!(index_folder(&root).unwrap()["good"]["name"],"Good");
        write_save(json!({"showsCache":{"good":{"name":"Updated"}}}),&library).unwrap();
        assert_eq!(load(root.join("Shows/Good.show")).unwrap()[1]["name"],"Updated");
        assert_eq!(fs::read(root.join("Shows/broken.show")).unwrap(),b"invalid json");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn failed_multi_file_save_rolls_back_previous_writes() {
        let root=std::env::temp_dir().join(format!("freeshow-save-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let library=Library{root:root.clone(),write_lock:Mutex::new(()).into()};
        let first=root.join("first.json");write_json(first.clone(),&json!({"old":true})).unwrap();
        fs::write(root.join("blocked"),b"file, not directory").unwrap();
        assert!(commit_library(&library,vec![(first.clone(),json!({"new":true})),(root.join("blocked/second.json"),json!({}))],vec![]).is_err());
        assert_eq!(load(first).unwrap(),json!({"old":true}));
        assert!(!root.join("blocked/second.json").exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn backup_save_returns_completed_zip_and_updates_timestamp_after_success() {
        let root=std::env::temp_dir().join(format!("freeshow-save-backup-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("Shows")).unwrap();
        let library=Library{root:root.clone(),write_lock:Mutex::new(()).into()};
        let result=write_save(json!({"SETTINGS":{"special":{"autoBackupPrevious":123}},"OVERLAYS":{"notice":{"name":"Notice"}},"customTriggers":{"backup":true}}),&library).unwrap();
        assert!(PathBuf::from(result["backupPath"].as_str().unwrap()).is_file());
        assert!(load(library.store_path("SETTINGS")).unwrap()["special"]["autoBackupPrevious"].as_u64().unwrap()>123);
        fs::remove_dir_all(root.join("Backups")).unwrap();fs::write(root.join("Backups"),b"blocked").unwrap();
        assert!(write_save(json!({"SETTINGS":{"special":{"autoBackupPrevious":123}},"customTriggers":{"backup":true}}),&library).is_err());
        assert_eq!(load(library.store_path("SETTINGS")).unwrap()["special"]["autoBackupPrevious"],123);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn media_recovery_preserves_edits_and_runs_once() {
        let root=std::env::temp_dir().join(format!("freeshow-recovery-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("Config")).unwrap();
        let library=Library{root:root.clone(),write_lock:Mutex::new(()).into()};
        write_json(library.store_path("OVERLAYS"),&json!({"existing":{"name":"Edited"}})).unwrap();
        write_json(library.store_path("SETTINGS"),&json!({"outputs":{"keep":true},"mediaFolders":{"existing":{"path":"keep"}}})).unwrap();
        write_json(root.join("pending-media-recovery.json"),&json!({"OVERLAYS":{"existing":{"name":"Old"},"restored":{"name":"Logo"}},"settings":{"mediaFolders":{"new":{"path":"new"}},"audioFolders":{}},"SYNCED_SETTINGS":{"overlayCategories":{"custom":{"name":"Custom"}},"timers":{"clock":{"start":300}}}})).unwrap();
        restore_media_assets(&library).unwrap();
        let overlays=load(library.store_path("OVERLAYS")).unwrap();
        assert_eq!(overlays["existing"]["name"],"Edited");assert_eq!(overlays["restored"]["name"],"Logo");
        let settings=load(library.store_path("SETTINGS")).unwrap();
        assert_eq!(settings["outputs"]["keep"],true);assert_eq!(settings["mediaFolders"].as_object().unwrap().len(),2);
        assert_eq!(load(library.store_path("SYNCED_SETTINGS")).unwrap()["timers"]["clock"]["start"],300);
        assert!(!root.join("pending-media-recovery.json").exists());
        restore_media_assets(&library).unwrap();
        assert_eq!(fs::read_dir(root.join("Asset Recovery Backups")).unwrap().count(),1);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn personal_library_uses_original_named_shows_and_config() {
        let root =
            std::env::temp_dir().join(format!("freeshow-folder-test-{}", std::process::id()));
        fs::create_dir_all(root.join("Shows")).unwrap();
        fs::create_dir_all(root.join("Config")).unwrap();
        let path = root.join("Shows").join("My personal show.show");
        write_json(
            path.clone(),
            &json!(["abc-123", {"name":"My personal show", "slides": {}}]),
        )
        .unwrap();
        let library = Library {
            root: root.clone(),
            write_lock: Mutex::new(()).into(),
        };
        assert_eq!(library.show_path("abc-123").unwrap(), path);
        assert_eq!(
            index_folder(&root).unwrap()["abc-123"]["name"],
            "My personal show"
        );
        assert_eq!(
            library.store_path("PROJECTS"),
            root.join("Config/projects.json")
        );
        assert_eq!(
            library.store_path("SETTINGS"),
            root.join("Config/settings_tauri.json")
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn rejects_paths_disguised_as_show_ids() {
        for invalid in ["", "../settings", "a/b", "a\\b", "C:drive", "."] {
            assert!(safe_id(invalid).is_err());
        }
        assert_eq!(safe_id("show-123_ab").unwrap(), "show-123_ab");
    }
    #[test]
    fn store_round_trip_replaces_previous_file_and_preserves_unicode() {
        let path =
            std::env::temp_dir().join(format!("freeshow-tauri-test-{}.json", std::process::id()));
        write_json(path.clone(), &json!({"old": true})).unwrap();
        let expected = json!({"name":"اختبار", "slides":["First", "Second"]});
        write_json(path.clone(), &expected).unwrap();
        assert_eq!(load(path.clone()).unwrap(), expected);
        fs::write(&path, "invalid json").unwrap();
        assert!(load(path.clone()).is_err());
        fs::remove_file(&path).unwrap();
        assert_eq!(load(path).unwrap(), json!({}));
    }
}
