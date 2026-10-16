use crate::{load, safe_id, Library};
use lofty::{
    file::{AudioFile, TaggedFileExt},
    probe::Probe,
    tag::{Accessor, ItemKey},
};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use tauri::{State, Webview};

pub(crate) fn bounded_text(path: &Path) -> Result<String, String> {
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > 64 * 1024 * 1024 {
        return Err("File exceeds the 64 MB text limit".into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        if bytes.len() % 2 != 0 {
            return Err("Invalid UTF-16 text file".into());
        }
        let little = bytes[0] == 0xff;
        let units = bytes[2..]
            .chunks_exact(2)
            .map(|b| {
                if little {
                    u16::from_le_bytes([b[0], b[1]])
                } else {
                    u16::from_be_bytes([b[0], b[1]])
                }
            })
            .collect::<Vec<_>>();
        return String::from_utf16(&units).map_err(|e| e.to_string());
    }
    let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&bytes);
    String::from_utf8(bytes.to_vec()).map_err(|e| e.to_string())
}
pub fn bible_store_path(folder: &Path, id: &str) -> Result<PathBuf, String> {
    safe_id(id)?;
    if folder.is_dir() {
        for entry in fs::read_dir(folder).map_err(|e| e.to_string())? {
            let p = entry.map_err(|e| e.to_string())?.path();
            if p.extension()
                .and_then(|s| s.to_str())
                .is_some_and(|s| s.eq_ignore_ascii_case("fsb"))
            {
                let value: Value =
                    serde_json::from_str(&bounded_text(&p)?).map_err(|e| e.to_string())?;
                if value[0].as_str() == Some(id) {
                    return Ok(p);
                }
            }
        }
    }
    Ok(folder.join(format!("{id}.fsb")))
}
fn bible(folder: &Path, id: &str) -> Result<Value, String> {
    safe_id(id)?;
    if !folder.is_dir() {
        return Ok(json!({"id":id,"error":"not_found"}));
    }
    for entry in fs::read_dir(folder).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if !path
            .extension()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.eq_ignore_ascii_case("fsb"))
        {
            continue;
        }
        let mut content: Value =
            serde_json::from_str(&bounded_text(&path)?).map_err(|e| e.to_string())?;
        if content[0].as_str() != Some(id) {
            continue;
        }
        if let Some(books) = content[1]["books"].as_array_mut() {
            for book in books {
                if let Some(chapters) = book["chapters"].as_array_mut() {
                    for chapter in chapters {
                        if let Some(verses) = chapter["verses"].as_array_mut() {
                            for verse in verses {
                                if let Some(v) = verse.as_object_mut() {
                                    if !v.contains_key("text") {
                                        if let Some(old) = v.remove("value") {
                                            v.insert("text".into(), old);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        return Ok(json!({"id":id,"content":content}));
    }
    Ok(json!({"id":id,"error":"not_found"}))
}
fn gain(db: Option<f64>, peak: Option<f64>) -> Option<f64> {
    db.filter(|v| v.is_finite())
        .map(|v| {
            let mut result = 10_f64.powf(v / 20.);
            if let Some(p) = peak.filter(|p| p.is_finite() && *p > 0.) {
                result = result.min(1. / p);
            }
            result
        })
        .filter(|v| v.is_finite())
}
fn audio(path: &Path) -> Result<Value, String> {
    let tagged = Probe::open(path)
        .map_err(|e| e.to_string())?
        .guess_file_type()
        .map_err(|e| e.to_string())?
        .read()
        .map_err(|e| e.to_string())?;
    let mut result = json!({"common":{},"format":{"duration":tagged.properties().duration().as_secs_f64(),"sampleRate":tagged.properties().sample_rate(),"channels":tagged.properties().channels()}});
    if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
        result["common"] = json!({"title":tag.title(),"artist":tag.artist(),"album":tag.album(),"genre":tag.genre().map(|s|vec![s.into_owned()]),"year":tag.get_string(ItemKey::RecordingDate).and_then(|s|s.get(..4)).and_then(|s|s.parse::<u32>().ok()),"track":{"no":tag.track(),"of":tag.track_total()}});
        let number = |key: ItemKey| {
            tag.get_string(key)
                .and_then(|s| s.split_whitespace().next()?.parse::<f64>().ok())
        };
        let db =
            number(ItemKey::ReplayGainTrackGain).or_else(|| number(ItemKey::ReplayGainAlbumGain));
        let peak =
            number(ItemKey::ReplayGainTrackPeak).or_else(|| number(ItemKey::ReplayGainAlbumPeak));
        if let Some(multiplier) = gain(db, peak) {
            result["replayGainMultiplier"] = json!(multiplier);
        }
    }
    Ok(result)
}
#[tauri::command]
pub async fn library_service(
    caller: Webview,
    library: State<'_, Library>,
    operation: String,
    data: Value,
) -> Result<Value, String> {
    if caller.label() != caller.window().label()
        || !(caller.label() == "main" || caller.label().starts_with("output-"))
    {
        return Err("Local application only".into());
    }
    let root = library.root.clone();
    tauri::async_runtime::spawn_blocking(move||{
        match operation.as_str(){
            "IMPORT_PACKAGE" => crate::packages::import(&root, Path::new(data["path"].as_str().ok_or("Missing package path")?)),
            "BIBLE"=>bible(&root.join("Bibles"),data["id"].as_str().ok_or("Missing Bible ID")?),
            "READ_BIBLES_FOLDER"=>{
                let folder=root.join("Bibles");let mut files=Vec::new();
                if folder.is_dir(){for entry in fs::read_dir(folder).map_err(|e|e.to_string())?{let p=entry.map_err(|e|e.to_string())?.path();if p.extension().and_then(|s|s.to_str()).is_some_and(|s|s.eq_ignore_ascii_case("fsb")){files.push(json!({"path":p,"name":p.file_stem().unwrap_or_default().to_string_lossy()}));}}}
                Ok(json!(files))
            }
            "READ_FILE"|"FILE_INFO"|"READ_AUDIO_METADATA"=>{
                let raw=if operation=="FILE_INFO"{data.as_str()}else if operation=="READ_AUDIO_METADATA"{data["filePath"].as_str()}else{data["path"].as_str()};
                let p=PathBuf::from(raw.ok_or("Missing file path")?);if !p.is_absolute(){return Err("Absolute file path required".into());}
                if operation=="READ_FILE"{return Ok(json!({"content":bounded_text(&p)?}));}
                if operation=="READ_AUDIO_METADATA"{return audio(&p);}
                let meta=fs::metadata(&p).map_err(|e|e.to_string())?;
                let time=|value:std::io::Result<std::time::SystemTime>|value.ok().and_then(|v|v.duration_since(UNIX_EPOCH).ok()).map(|v|v.as_millis()).unwrap_or(0);
                Ok(json!({"path":p,"folder":meta.is_dir(),"size":meta.len(),"birthtimeMs":time(meta.created()),"mtimeMs":time(meta.modified())}))
            }
            "FULL_SHOWS_LIST"=>Ok(json!(crate::index_folder(&root)?.as_object().map(|v|v.keys().cloned().collect::<Vec<_>>()).unwrap_or_default())),
            "GET_STORE_VALUE"=>{let key=data["file"].as_str().ok_or("Missing store")?.to_uppercase();if !crate::STORES.contains(&key.as_str()){return Err("Unknown store".into());}Ok(load(Library{root,write_lock:std::sync::Mutex::new(()).into()}.store_path(&key))?[data["key"].as_str().ok_or("Missing key")?].clone())}
            _=>Err("Unsupported library operation".into())
        }
    }).await.map_err(|e|e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn text_export_follows_layout_and_preserves_children_and_runs() {
        let show=json!({"name":"Song","layouts":{"default":{"slides":[{"id":"verse"}]}},"slides":{"chorus":{"items":[{"lines":[{"text":[{"value":"Chorus"}]}]}]},"verse":{"children":["chorus"],"items":[{"lines":[{"text":[{"value":"First "},{"value":"line"}]},{"text":[{"value":"Second"}]}]}]}}});
        assert_eq!(show_text(&show),"Song\n\nFirst line\nSecond\n\nChorus");
    }
    #[test]
    #[ignore = "Requires FREESHOW_TEST_BIBLE_FOLDER pointing to a read-only real library"]
    fn supplied_bible_loads_real_books() {
        let folder = PathBuf::from(std::env::var("FREESHOW_TEST_BIBLE_FOLDER").unwrap());
        let entries = fs::read_dir(&folder).unwrap();
        let mut checked = 0;
        for entry in entries {
            let p = entry.unwrap().path();
            if p.extension().and_then(|s| s.to_str()) == Some("fsb") {
                let original: Value = serde_json::from_str(&bounded_text(&p).unwrap()).unwrap();
                let id = original[0].as_str().unwrap();
                let loaded = bible(&folder, id).unwrap();
                assert_eq!(
                    loaded["content"][1]["books"].as_array().unwrap().len(),
                    original[1]["books"].as_array().unwrap().len()
                );
                assert!(
                    !loaded["content"][1]["books"][0]["chapters"][0]["verses"][0]["text"]
                        .as_str()
                        .unwrap()
                        .is_empty()
                );
                assert_eq!(bible_store_path(&folder, id).unwrap(), p);
                checked += 1;
            }
        }
        assert!(checked > 0);
    }
    #[test]
    fn decodes_utf_boms_and_rejects_invalid_utf16() {
        let p = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::write(&p, [0xff, 0xfe, 0x41, 0x00]).unwrap();
        assert_eq!(bounded_text(&p).unwrap(), "A");
        fs::write(&p, [0xef, 0xbb, 0xbf, 0x41]).unwrap();
        assert_eq!(bounded_text(&p).unwrap(), "A");
        fs::write(&p, [0xfe, 0xff, 0x00]).unwrap();
        assert!(bounded_text(&p).is_err());
        fs::remove_file(p).unwrap();
    }
    #[test]
    fn reads_bible_by_id_and_converts_legacy_verses() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("Different name.fsb"),r#"["id",{"books":[{"chapters":[{"verses":[{"value":"Legacy"},{"text":"Keep","value":"Old"}]}]}]}]"#).unwrap();
        let loaded = bible(&root, "id").unwrap();
        assert_eq!(
            loaded["content"][1]["books"][0]["chapters"][0]["verses"][0]["text"],
            "Legacy"
        );
        assert_eq!(
            loaded["content"][1]["books"][0]["chapters"][0]["verses"][1]["text"],
            "Keep"
        );
        assert_eq!(bible(&root, "absent").unwrap()["error"], "not_found");
        assert!(bible(&root, "../bad").is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn replay_gain_respects_peak() {
        assert!((gain(Some(6.), Some(2.)).unwrap() - 0.5).abs() < 0.00001);
        assert!((gain(Some(-6.), None).unwrap() - 0.501187).abs() < 0.00001);
        assert!(gain(Some(f64::NAN), None).is_none());
    }
    #[test]
    fn reads_actual_pcm_audio_and_rejects_invalid_data() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&root).unwrap();
        let mut wav = Vec::new();
        wav.extend(b"RIFF");
        wav.extend(16036_u32.to_le_bytes());
        wav.extend(b"WAVEfmt ");
        wav.extend(16_u32.to_le_bytes());
        wav.extend(1_u16.to_le_bytes());
        wav.extend(1_u16.to_le_bytes());
        wav.extend(8000_u32.to_le_bytes());
        wav.extend(16000_u32.to_le_bytes());
        wav.extend(2_u16.to_le_bytes());
        wav.extend(16_u16.to_le_bytes());
        wav.extend(b"data");
        wav.extend(16000_u32.to_le_bytes());
        wav.resize(16044, 0);
        let p = root.join("silence.wav");
        fs::write(&p, wav).unwrap();
        let metadata = audio(&p).unwrap();
        assert!((metadata["format"]["duration"].as_f64().unwrap() - 1.).abs() < 0.001);
        assert_eq!(metadata["format"]["sampleRate"], 8000);
        assert!(metadata.get("replayGainMultiplier").is_none());
        fs::write(&p, b"invalid").unwrap();
        assert!(audio(&p).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn exports_preserve_previous_files_and_round_trip_json() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let payload = br#"{"name":"Example"}"#;
        let first = save_export(&root, "CON/../Name", "fstemplate", payload).unwrap();
        let second = save_export(&root, "CON/../Name", "fstemplate", b"second").unwrap();
        assert_ne!(first, second);
        assert_eq!(load(first.clone()).unwrap()["name"], "Example");
        assert_eq!(first.parent(), Some(root.as_path()));
        fs::remove_dir_all(root).unwrap();
    }
}

pub(crate) fn file_name(name: &str) -> String {
    let clean: String = name
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let clean = clean.trim_matches([' ', '.']);
    let clean = if clean.is_empty() { "Export" } else { clean };
    // Prefix to avoid Windows reserved device filenames such as CON.
    format!("FreeShow {clean}")
}
pub(crate) fn save_export(
    folder: &Path,
    name: &str,
    extension: &str,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    fs::create_dir_all(folder).map_err(|e| e.to_string())?;
    let base = file_name(name);
    for number in 0..10000 {
        let suffix = if number == 0 {
            String::new()
        } else {
            format!(" ({number})")
        };
        let p = folder.join(format!("{base}{suffix}.{extension}"));
        use std::io::Write;
        match fs::OpenOptions::new().create_new(true).write(true).open(&p) {
            Ok(mut file) => {
                file.write_all(bytes).map_err(|e| e.to_string())?;
                return Ok(p);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("Too many files with this export name".into())
}
fn show_text(show: &Value) -> String {
    let mut text=show["name"].as_str().unwrap_or("Show").to_owned();
    if let Some(slides)=show["slides"].as_object() {
        let mut order=Vec::new();
        if let Some(layout)=show["layouts"].as_object().and_then(|v|v.values().next()) {
            if let Some(refs)=layout["slides"].as_array(){ for reference in refs {
                if let Some(id)=reference["id"].as_str(){order.push(id.to_owned());if let Some(children)=slides.get(id).and_then(|s|s["children"].as_array()){for child in children{if let Some(id)=child.as_str(){order.push(id.to_owned());}}}}
            }}
        }
        if order.is_empty(){order.extend(slides.keys().cloned());}
        for id in order {
            let Some(slide)=slides.get(&id) else {continue};
            if let Some(items)=slide["items"].as_array(){for item in items{
                if let Some(lines)=item["lines"].as_array(){
                    text.push_str("\n\n");
                    for (index,line) in lines.iter().enumerate(){
                        if index>0{text.push('\n');}
                        if let Some(runs)=line["text"].as_array(){for run in runs{if let Some(value)=run["value"].as_str(){text.push_str(&value.replace("<br>","\n"));}}}
                    }
                }
            }}
        }
    }
    text
}
#[tauri::command]
pub async fn export_library(
    caller: Webview,
    library: State<'_, Library>,
    msg: Value,
) -> Result<Value, String> {
    if caller.label() != "main" || caller.label() != caller.window().label() {
        return Err("Export from the editor".into());
    }
    let root = library.root.clone();
    tauri::async_runtime::spawn_blocking(move||{
        let data=&msg["data"];let channel=msg["channel"].as_str().ok_or("Missing export channel")?;
        let folder=root.join("Exports");
        if channel=="USAGE"{let content=serde_json::to_vec_pretty(&data["content"]).map_err(|e|e.to_string())?;let name=format!("Usage-{}",std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs());return Ok(json!({"files":[save_export(&folder.join("Usage"),&name,"json",&content)?]}));}
        let extension=match channel{"TEMPLATE"=>Some("fstemplate"),"OVERLAY"=>Some("fsoverlay"),"THEME"=>Some("fstheme"),"ACTION"=>Some("fsaction"),"STAGE_LAYOUT"=>Some("fsstage"),_=>None};
        if let Some(extension)=extension {
            let payload=if channel=="TEMPLATE"||channel=="OVERLAY"{&data["file"]}else{&data["content"]};
            let name=data["name"].as_str().or_else(||payload["name"].as_str()).unwrap_or(channel);
            return Ok(json!({"files":[crate::packages::export(&folder,name,extension,payload,data["path"].as_str().or_else(||data["customPath"].as_str()))?]}));
        }
        if channel=="GENERATE" || channel=="ALL_SHOWS" {
            let kind=data["type"].as_str().ok_or("Missing export type")?;
            if kind=="project" {
                return Ok(json!({"files":[crate::packages::export(&folder,data["name"].as_str().unwrap_or("Project"),"project",&data["file"],data["path"].as_str().or_else(||data["customPath"].as_str()))?]}));
            }
            if !matches!(kind,"show"|"txt"){return Err(format!("The {kind} export converter is not available yet"));}
            let library=Library{root:root.clone(),write_lock:std::sync::Mutex::new(()).into()};
            let index=crate::index_folder(&root)?;let mut ids=Vec::new();
            if channel=="ALL_SHOWS" { if let Some(index)=index.as_object(){ids.extend(index.keys().cloned());} }
            else if let Some(requested)=data["showIds"].as_array(){for id in requested {if let Some(id)=id.as_str(){ids.push(id.to_owned());}}}
            else if let Some(names)=data["showNames"].as_array(){if let Some(index)=index.as_object(){for name in names {for (id,show) in index {if show["name"]==*name{ids.push(id.clone());}}}}}
            let mut files=Vec::new();
            for id in ids {let content=load(library.show_path(&id)?)?;if content[1].is_object(){let bytes=if kind=="txt"{show_text(&content[1]).into_bytes()}else{serde_json::to_vec_pretty(&content).map_err(|e|e.to_string())?};files.push(save_export(&folder,content[1]["name"].as_str().unwrap_or(&id),kind,&bytes)?);}}
            if files.is_empty(){return Err("No shows selected for export".into());}
            return Ok(json!({"files":files}));
        }
        Err(format!("The {channel} export service is not available yet"))
    }).await.map_err(|e|e.to_string())?
}
