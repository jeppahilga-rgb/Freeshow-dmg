use serde_json::{json, Map, Value};
use std::{collections::HashSet, fs, path::{Path, PathBuf}, time::UNIX_EPOCH};
use tauri::{Manager, Webview};
use std::hash::{Hash, Hasher};

fn thumbnail_cache_path(root: &Path, input: &Path, size: u64) -> Result<PathBuf, String> {
    let meta = fs::metadata(input).map_err(|e| e.to_string())?;
    if !meta.is_file() { return Err("Media file not found".into()); }
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    input.hash(&mut hash);
    meta.len().hash(&mut hash);
    timestamp(meta.modified()).hash(&mut hash);
    size.clamp(32, 1920).hash(&mut hash);
    Ok(root.join(format!("{:016x}.png", hash.finish())))
}

fn write_thumbnail(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > 16 * 1024 * 1024 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("Invalid thumbnail PNG".into());
    }
    fs::create_dir_all(path.parent().ok_or("Missing cache directory")?).map_err(|e| e.to_string())?;
    let partial = path.with_extension(format!("{}.partial", uuid::Uuid::new_v4()));
    fs::write(&partial, bytes).map_err(|e| e.to_string())?;
    if path.is_file() { let _ = fs::remove_file(&partial); return Ok(()); }
    fs::rename(&partial, path).map_err(|e| { let _ = fs::remove_file(&partial); e.to_string() })
}

fn trusted(view: &Webview) -> Result<(), String> {
    if view.label() == view.window().label() && (view.label() == "main" || view.label().starts_with("output-")) { Ok(()) }
    else { Err("Local application only".into()) }
}
fn absolute(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if !path.is_absolute() { return Err("An absolute media path is required".into()); }
    Ok(path)
}
fn grant(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    app.asset_protocol_scope().allow_file(path).map_err(|e| e.to_string())
}
fn timestamp(time: std::io::Result<std::time::SystemTime>) -> u128 {
    time.ok().and_then(|v| v.duration_since(UNIX_EPOCH).ok()).map(|v| v.as_millis()).unwrap_or(0)
}
fn scan(path: &Path, depth: usize, current: usize, seen: &mut HashSet<PathBuf>, result: &mut Map<String, Value>) -> Result<(), String> {
    let canonical = fs::canonicalize(path).map_err(|e| e.to_string())?;
    if !seen.insert(canonical) || result.len() >= 20000 { return Ok(()); }
    let mut children = Vec::new();
    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let p = entry.path();
        children.push(p.to_string_lossy().into_owned());
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            if current <= depth { let _ = scan(&p, depth, current + 1, seen, result); }
        } else if current <= depth && meta.is_file() {
            result.insert(p.to_string_lossy().into_owned(), json!({"isFolder":false,"path":p,"name":entry.file_name().to_string_lossy(),"stats":{"size":meta.len(),"birthtimeMs":timestamp(meta.created()),"mtimeMs":timestamp(meta.modified())}}));
        }
    }
    result.insert(path.to_string_lossy().into_owned(), json!({"isFolder":true,"path":path,"name":path.file_name().unwrap_or_default().to_string_lossy(),"files":children}));
    Ok(())
}
#[tauri::command]
pub async fn media_files(app: tauri::AppHandle, caller: Webview, operation: String, data: Value) -> Result<Value, String> {
    trusted(&caller)?;
    tauri::async_runtime::spawn_blocking(move || {
        match operation.as_str() {
            "THUMBNAIL_CACHE" | "STORE_THUMBNAIL" => {
                let input = absolute(data["input"].as_str().ok_or("Missing media path")?)?;
                let root = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("media-cache");
                let path = thumbnail_cache_path(&root, &input, data["size"].as_u64().unwrap_or(250))?;
                if operation == "STORE_THUMBNAIL" {
                    let values = data["bytes"].as_array().ok_or("Missing thumbnail bytes")?;
                    if values.len() > 16 * 1024 * 1024 { return Err("Thumbnail too large".into()); }
                    let bytes: Result<Vec<u8>, String> = values.iter().map(|v| v.as_u64().filter(|v| *v <= 255).map(|v| v as u8).ok_or("Invalid thumbnail byte".into())).collect();
                    write_thumbnail(&path, &bytes?)?;
                }
                if !path.is_file() { return Ok(Value::Null); }
                grant(&app, &path)?;
                Ok(json!({"input":input,"output":path,"size":data["size"]}))
            }
            "READ_FOLDER" => {
                let paths = data["path"].as_array().cloned().unwrap_or_else(|| vec![data["path"].clone()]);
                let depth = data["depth"].as_u64().unwrap_or(0).min(16) as usize;
                let mut result = Map::new(); let mut seen = HashSet::new();
                for path in paths {
                    let p = absolute(path.as_str().ok_or("Missing folder path")?)?;
                    if !p.is_dir() { continue; }
                    scan(&p, depth, 0, &mut seen, &mut result)?;
                }
                Ok(Value::Object(result))
            }
            "DOES_MEDIA_EXIST" => {
                let p = absolute(data["path"].as_str().ok_or("Missing media path")?)?;
                let metadata = fs::metadata(&p).ok().filter(|m|m.is_file());
                if metadata.is_some() { grant(&app, &p)?; }
                Ok(json!({"path":p,"exists":metadata.is_some(),"creationTime":metadata.map(|m|timestamp(m.created())).unwrap_or(0)}))
            }
            "LOCATE_MEDIA_FILE" => {
                let p = absolute(data["filePath"].as_str().ok_or("Missing media path")?)?;
                if p.is_file() { grant(&app,&p)?; return Ok(json!({"path":p,"hasChanged":false})); }
                let name = p.file_name().ok_or("Missing file name")?;
                let mut found = Vec::new();
                if let Some(folders) = data["folders"].as_array() {
                    for folder in folders {
                        let root = absolute(folder.as_str().ok_or("Invalid folder")?)?;
                        if !root.is_dir() { continue; }
                        let mut entries = Map::new(); let mut seen = HashSet::new();
                        scan(&root, 8, 0, &mut seen, &mut entries)?;
                        for (path, item) in entries { let candidate=PathBuf::from(path); if item["isFolder"]==false && candidate.file_name()==Some(name) && !found.contains(&candidate) { found.push(candidate); } }
                    }
                }
                if found.len()!=1 { return Ok(Value::Null); }
                grant(&app,&found[0])?;
                Ok(json!({"path":found[0],"hasChanged":true}))
            }
            "GRANT" => { let p=absolute(data["path"].as_str().ok_or("Missing path")?)?; if !p.is_file(){return Err("Media file not found".into());} grant(&app,&p)?; Ok(json!({"path":p})) }
            _ => Err("Unknown media operation".into())
        }
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn pick_media_files(app: tauri::AppHandle, caller: Webview, data: Value) -> Result<Value,String> {
    trusted(&caller)?;
    if caller.label()!="main" { return Err("Choose files in the editor".into()); }
    let window=caller.window();
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog=rfd::FileDialog::new().set_parent(&window).set_title(data["title"].as_str().unwrap_or("Choose media files"));
        let filters=data["filter"].as_array().cloned().unwrap_or_else(||vec![data["filter"].clone()]);
        for filter in filters { if let Some(ext)=filter["extensions"].as_array(){let extensions=ext.iter().filter_map(Value::as_str).filter(|v|*v!="*").collect::<Vec<_>>();if !extensions.is_empty(){dialog=dialog.add_filter(filter["name"].as_str().unwrap_or("Files"),&extensions);}} }
        let files=if data["multiple"]==false { dialog.pick_file().map(|p|vec![p]).unwrap_or_default() } else { dialog.pick_files().unwrap_or_default() };
        let mut content=Map::new();
        for path in &files {grant(&app,path)?;if data["read"]==true {let meta=fs::metadata(path).map_err(|e|e.to_string())?;if meta.len()>32*1024*1024{return Err("Import file exceeds 32 MB".into());}content.insert(path.to_string_lossy().into_owned(),json!(fs::read_to_string(path).map_err(|e|e.to_string())?));}}
        Ok(json!({"files":files,"content":content,"channel":data["channel"],"id":data["id"]}))
    }).await.map_err(|e|e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn thumbnail_cache_validates_data_and_invalidates_changed_sources() {
        let root = std::env::temp_dir().join(format!("freeshow-thumb-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let input = root.join("photo.jpg");
        fs::write(&input, b"source").unwrap();
        let first = thumbnail_cache_path(&root.join("cache"), &input, 250).unwrap();
        assert_ne!(first, thumbnail_cache_path(&root.join("cache"), &input, 500).unwrap());
        assert!(write_thumbnail(&first, b"not PNG").is_err());
        write_thumbnail(&first, b"\x89PNG\r\n\x1a\nfixture").unwrap();
        assert!(first.is_file());
        fs::write(&input, b"changed source").unwrap();
        assert_ne!(first, thumbnail_cache_path(&root.join("cache"), &input, 250).unwrap());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn folders_include_nested_media_and_preserve_special_names() {
        let root=std::env::temp_dir().join(format!("freeshow-media-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("nested")).unwrap();
        fs::write(root.join("photo #100%.png"),b"image").unwrap();
        fs::write(root.join("nested/clip.mp4"),b"video").unwrap();
        let mut result=Map::new();scan(&root,0,0,&mut HashSet::new(),&mut result).unwrap();
        assert!(result.contains_key(root.join("photo #100%.png").to_str().unwrap()));
        assert!(!result.contains_key(root.join("nested").join("clip.mp4").to_str().unwrap()));
        assert_eq!(result[root.join("nested").to_str().unwrap()]["files"].as_array().unwrap().len(),1);
        result.clear();scan(&root,1,0,&mut HashSet::new(),&mut result).unwrap();
        assert!(result.contains_key(root.join("nested").join("clip.mp4").to_str().unwrap()));
        fs::remove_dir_all(root).unwrap();
    }
}
