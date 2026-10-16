use crate::Library;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use tauri::{State, Webview};

#[derive(Default)]
pub struct DropFiles(Mutex<HashMap<String, Session>>);
struct Session {
    root: PathBuf,
    bytes: u64,
}
#[derive(Deserialize)]
pub struct DropRequest {
    action: String,
    token: Option<String>,
    relative: Option<String>,
    offset: Option<u64>,
    bytes: Option<Vec<u8>>,
}
fn target(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let drive = relative.as_bytes().get(0).is_some_and(u8::is_ascii_alphabetic)
        && relative.as_bytes().get(1) == Some(&b':');
    if drive || relative.contains('\\') {
        return Err("Dropped file path must be a relative forward-slash path".into());
    }
    let relative = Path::new(relative);
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|p| !matches!(p, Component::Normal(_)))
    {
        return Err("Dropped file path must stay inside its import folder".into());
    }
    Ok(root.join(relative))
}
fn append(session: &mut Session, relative: &str, offset: u64, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > 256 * 1024 || session.bytes + bytes.len() as u64 > 8 * 1024 * 1024 * 1024 {
        return Err("Dropped files exceed the transfer limit".into());
    }
    let path = target(&session.root, relative)?;
    fs::create_dir_all(path.parent().ok_or("Invalid dropped file path")?)
        .map_err(|e| e.to_string())?;
    let mut options = fs::OpenOptions::new();
    options.write(true).append(true);
    if offset == 0 {
        options.create_new(true);
    }
    let mut file = options.open(&path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() != offset {
        return Err("Dropped file chunk is out of order".into());
    }
    file.write_all(bytes).map_err(|e| e.to_string())?;
    session.bytes += bytes.len() as u64;
    Ok(())
}
#[tauri::command]
pub async fn dropped_files(
    caller: Webview,
    library: State<'_, Library>,
    sessions: State<'_, DropFiles>,
    request: DropRequest,
) -> Result<Value, String> {
    if caller.label() != "main" || caller.label() != caller.window().label() {
        return Err("Drop files in the editor".into());
    }
    let mut sessions = sessions.0.lock().map_err(|e| e.to_string())?;
    if request.action == "start" {
        if sessions.len() >= 4 {
            return Err("Wait for the current file drops to finish".into());
        }
        let token = uuid::Uuid::new_v4().to_string();
        let root = library.root.join("Imports").join("Dropped").join(&token);
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        sessions.insert(
            token.clone(),
            Session {
                root: root.clone(),
                bytes: 0,
            },
        );
        return Ok(json!({"token":token,"path":root}));
    }
    let token = request.token.ok_or("Missing file drop token")?;
    if request.action == "finish" || request.action == "cancel" {
        let session = sessions.remove(&token).ok_or("File drop expired")?;
        if request.action == "cancel" {
            fs::remove_dir_all(session.root).map_err(|e| e.to_string())?;
        }
        return Ok(Value::Null);
    }
    let session = sessions.get_mut(&token).ok_or("File drop expired")?;
    let relative = request.relative.ok_or("Missing dropped file name")?;
    match request.action.as_str() {
        "directory" => {
            fs::create_dir_all(target(&session.root, &relative)?).map_err(|e| e.to_string())?
        }
        "append" => append(
            session,
            &relative,
            request.offset.ok_or("Missing chunk offset")?,
            &request.bytes.ok_or("Missing chunk bytes")?,
        )?,
        _ => return Err("Unknown file drop operation".into()),
    }
    Ok(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dropped_files_stream_in_order_without_overwriting() {
        let root = std::env::temp_dir().join(format!("freeshow-drop-{}", uuid::Uuid::new_v4()));
        let mut session = Session {
            root: root.clone(),
            bytes: 0,
        };
        append(&mut session, "Nested/Unicode name.png", 0, b"first").unwrap();
        assert!(append(&mut session, "Nested/Unicode name.png", 0, b"replace").is_err());
        assert!(append(&mut session, "Nested/Unicode name.png", 99, b"wrong").is_err());
        append(&mut session, "Nested/Unicode name.png", 5, b"second").unwrap();
        assert_eq!(
            fs::read(root.join("Nested/Unicode name.png")).unwrap(),
            b"firstsecond"
        );
        assert!(append(&mut session, "../escape", 0, b"bad").is_err());
        assert!(append(&mut session, "C:/escape", 0, b"bad").is_err());
        assert!(append(&mut session, "oversize", 0, &vec![0; 256 * 1024 + 1]).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
