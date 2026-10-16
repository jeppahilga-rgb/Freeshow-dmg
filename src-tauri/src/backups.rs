use crate::{load, safe_id, write_json, Library, STORES};
use serde_json::{json, Value};
use std::{fs, io::Read, path::{Path, PathBuf}, time::{SystemTime, UNIX_EPOCH}};
use tauri::{State, Webview};

fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }

pub fn create(library: &Library, auto: bool) -> Result<PathBuf, String> {
    let folder = library.root.join("Backups");
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let name = format!("{}-{}{}.zip", now(), uuid::Uuid::new_v4(), if auto { "_auto" } else { "" });
    let path = folder.join(name);
    let temporary = path.with_extension("partial");
    let result = (|| {
        let file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|e| e.to_string())?;
        let mut archive = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        let mut add = |name: String, source: PathBuf| -> Result<(), String> {
            if !source.is_file() { return Ok(()); }
            archive.start_file(name, options).map_err(|e| e.to_string())?;
            std::io::copy(&mut fs::File::open(source).map_err(|e| e.to_string())?, &mut archive).map_err(|e| e.to_string())?;
            Ok(())
        };
        for key in STORES { add(format!("{key}.json"), library.store_path(key))?; }
        add("SHOWS.json".into(), library.root.join("show-index.json"))?;
        for (folder, prefix, extension) in [("Shows", "SHOWS", "show"), ("Bibles", "BIBLES", "json")] {
            if !library.root.join(folder).is_dir() { continue; }
            for entry in fs::read_dir(library.root.join(folder)).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                if !entry.file_type().map_err(|e| e.to_string())?.is_file() { continue; }
                let source = entry.path();
                if source.extension().and_then(|s| s.to_str()).is_some_and(|s| s.eq_ignore_ascii_case(extension) || (folder == "Bibles" && s.eq_ignore_ascii_case("fsb"))) {
                    add(format!("{prefix}/{}", entry.file_name().to_string_lossy()), source)?;
                }
            }
        }
        archive.finish().map_err(|e| e.to_string())?.sync_all().map_err(|e| e.to_string())?;
        fs::rename(&temporary, &path).map_err(|e| e.to_string())?;
        Ok(path.clone())
    })();
    if result.is_err() { let _ = fs::remove_file(temporary); }
    result
}

fn list(root: &Path) -> Result<Value, String> {
    let folder = root.join("Backups");
    if !folder.exists() { return Ok(json!([])); }
    let mut files = Vec::new();
    for entry in fs::read_dir(folder).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !entry.file_type().map_err(|e| e.to_string())?.is_file() || path.extension().and_then(|s| s.to_str()) != Some("zip") { continue; }
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let date = metadata.modified().unwrap_or(UNIX_EPOCH).duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
        files.push(json!({"path": path, "name":path.file_stem().unwrap().to_string_lossy(),"date":date,"size":metadata.len()}));
    }
    Ok(json!(files))
}

fn restore(library: &Library, path: &Path) -> Result<Value, String> {
    let mut archive = zip::ZipArchive::new(fs::File::open(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if archive.len() > 20000 { return Err("Backup has too many entries".into()); }
    let mut writes = Vec::<(PathBuf, Value)>::new();
    let mut total = 0_u64;
    let mut seen = std::collections::HashSet::new();
    // Validate every supported entry before writing; no archive paths are extracted.
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() { continue; }
        let name = entry.name().replace('\\', "/");
        if entry.enclosed_name().is_none() { return Err("Invalid backup entry path".into()); }
        let destination = if let Some(key) = name.strip_suffix(".json").filter(|key| STORES.contains(key)) {
            Some(library.store_path(key))
        } else if name == "SHOWS.json" && !library.root.join("Config").is_dir() {
            Some(library.root.join("show-index.json"))
        } else if name.starts_with("SHOWS/") && name.ends_with(".show") {
            Some(PathBuf::new()) // Resolve by validated show ID, never by an archive filename.
        } else if let Some(name) = name.strip_prefix("BIBLES/").or_else(|| name.strip_prefix("BIBLE_")) {
            if name.contains('/') || !(name.ends_with(".json") || name.ends_with(".fsb")) { return Err("Invalid Bible backup entry".into()); }
            Some(library.root.join("Bibles").join(name))
        } else { None };
        let Some(mut destination) = destination else { continue; };
        total += entry.size();
        if entry.size() > 64 * 1024 * 1024 || total > 512 * 1024 * 1024 { return Err("Backup exceeds restore limits".into()); }
        let mut bytes = Vec::new();
        (&mut entry).take(64 * 1024 * 1024 + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        if bytes.len() > 64 * 1024 * 1024 { return Err("Backup entry exceeds restore limit".into()); }
        let mut value: Value = serde_json::from_slice(&bytes).map_err(|e| format!("Invalid {name}: {e}"))?;
        if destination.as_os_str().is_empty() {
            let id = value[0].as_str().ok_or("Backup show has no identifier")?;
            safe_id(id)?;
            if !value[1].is_object() { return Err("Invalid backup show".into()); }
            destination = library.show_path(id)?;
        } else if !value.is_object() && !name.starts_with("BIBLE") { return Err(format!("Invalid store {name}")); }
        if name == "SETTINGS.json" {
            if let Some(settings) = value.as_object_mut() { settings.remove("dataPath"); settings.remove("showsPath"); }
        }
        if !seen.insert(destination.clone()) { return Err(format!("Duplicate backup entry: {name}")); }
        writes.push((destination, value));
    }
    if writes.is_empty() { return Err("No supported FreeShow data in this backup".into()); }
    let safety_backup = create(library, false)?;
    let originals: Vec<_> = writes.iter().map(|(p, _)| {
        match fs::read(p) { Ok(bytes) => Ok((p.clone(), Some(bytes))), Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok((p.clone(), None)), Err(e) => Err(e.to_string()) }
    }).collect::<Result<_, _>>()?;
    for (path, value) in &writes {
        let result = fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string()).and_then(|_| write_json(path.clone(), value));
        if let Err(error) = result {
            let mut failures = Vec::new();
            for (path, bytes) in &originals {
                let result = match bytes { Some(bytes) => fs::write(path, bytes), None if path.exists() => fs::remove_file(path), None => Ok(()) };
                if let Err(e) = result { failures.push(format!("{}: {e}", path.display())); }
            }
            return Err(format!("Restore failed: {error}. Safety backup: {}. Rollback errors: {}", safety_backup.display(), failures.join(", ")));
        }
    }
    let mut stores = serde_json::Map::new();
    for key in STORES { stores.insert((*key).into(), load(library.store_path(key))?); }
    let shows = if library.root.join("Config").is_dir() { crate::index_folder(&library.root)? } else { load(library.root.join("show-index.json"))? };
    Ok(json!({"stores":stores,"shows":shows,"safetyBackup":safety_backup}))
}

#[tauri::command]
pub async fn backup_service(caller: Webview, library: State<'_, Library>, operation: String, path: Option<String>) -> Result<Value, String> {
    if caller.label() != "main" || caller.label() != caller.window().label() { return Err("Editor only".into()); }
    let root = library.root.clone();
    let selected = if operation == "RESTORE" && path.is_none() {
        rfd::AsyncFileDialog::new().set_title("Restore FreeShow backup").add_filter("FreeShow backup", &["zip"]).pick_file().await.map(|f| f.path().to_owned())
    } else { path.map(PathBuf::from) };
    if operation == "RESTORE" && selected.is_none() { return Ok(Value::Null); }
    let library = library.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
    let _guard = library.write_lock.lock().map_err(|e| e.to_string())?;
    match operation.as_str() {
        "BACKUPS" => list(&root),
        "RESTORE" => restore(&library, &selected.unwrap()),
        "DELETE_BACKUP" => {
            let path = selected.ok_or("Missing backup path")?.canonicalize().map_err(|e| e.to_string())?;
            let folder = root.join("Backups").canonicalize().map_err(|e| e.to_string())?;
            if path.parent() != Some(folder.as_path()) || path.extension().and_then(|s| s.to_str()) != Some("zip") { return Err("Choose a ZIP in this library's Backups folder".into()); }
            fs::remove_file(path).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        _ => Err("Unknown backup operation".into())
    }
    }).await.map_err(|e|e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    #[test]
    fn backup_roundtrip_preserves_data_and_rejects_corruption_before_writing() {
        let root = std::env::temp_dir().join(format!("freeshow-backup-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("Shows")).unwrap();
        let library = Library { root:root.clone(), write_lock:std::sync::Mutex::new(()).into() };
        write_json(library.store_path("OVERLAYS"), &json!({"notice":{"name":"Notice"}})).unwrap();
        write_json(root.join("Shows/one.show"), &json!(["one",{"name":"First"}])).unwrap();
        write_json(root.join("show-index.json"), &json!({"one":{"name":"First"}})).unwrap();
        let backup = create(&library, false).unwrap();
        assert_eq!(list(&root).unwrap().as_array().unwrap().len(),1);
        write_json(library.store_path("OVERLAYS"), &json!({"new":{"name":"Changed"}})).unwrap();
        let restored = restore(&library, &backup).unwrap();
        assert_eq!(restored["stores"]["OVERLAYS"]["notice"]["name"], "Notice");
        assert!(PathBuf::from(restored["safetyBackup"].as_str().unwrap()).is_file());
        let bad=root.join("bad.zip");
        let mut zip=zip::ZipWriter::new(fs::File::create(&bad).unwrap());
        zip.start_file("OVERLAYS.json",zip::write::SimpleFileOptions::default()).unwrap();zip.write_all(b"not json").unwrap();zip.finish().unwrap();
        assert!(restore(&library,&bad).is_err());
        assert_eq!(load(library.store_path("OVERLAYS")).unwrap()["notice"]["name"],"Notice");
        fs::remove_dir_all(root).unwrap();
    }
}
