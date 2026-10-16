use crate::Library;
use serde_json::{json, Map, Value};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
};
use tauri::{State, Webview};

fn document_bytes(source: &Path) -> Result<Vec<u8>, String> {
    if !source.is_absolute() || !source.is_file() { return Err("Select an existing document".into()); }
    let extension = source.extension().and_then(|x| x.to_str()).unwrap_or("").to_lowercase();
    let temporary = std::env::temp_dir().join(format!("freeshow-{}.pdf", uuid::Uuid::new_v4()));
    let pdf = if extension == "pdf" { source.to_path_buf() } else if extension == "pptx" || extension == "ppt" {
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            let script = "$ErrorActionPreference='Stop'; $ppt=New-Object -ComObject PowerPoint.Application; $doc=$null; $existing=$ppt.Presentations.Count; $security=$ppt.AutomationSecurity; try { $ppt.AutomationSecurity=3; $doc=$ppt.Presentations.Open($env:FREESHOW_DOCUMENT_INPUT,-1,0,0); $doc.SaveAs($env:FREESHOW_DOCUMENT_OUTPUT,32) } finally { if($doc){$doc.Close(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($doc)}; $ppt.AutomationSecurity=$security; if($existing -eq 0){$ppt.Quit()}; [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) }";
            let mut child = std::process::Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-Command", script])
                .env("FREESHOW_DOCUMENT_INPUT", source).env("FREESHOW_DOCUMENT_OUTPUT", &temporary)
                .creation_flags(0x08000000).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
                .spawn().map_err(|e| e.to_string())?;
            let start = std::time::Instant::now();
            loop {
                if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                    if !status.success() { let _=fs::remove_file(&temporary); return Err("PowerPoint conversion failed. Microsoft PowerPoint must be installed; close any Office dialog and retry.".into()); }
                    break;
                }
                if start.elapsed().as_secs() > 180 { let _=child.kill(); let _=child.wait(); let _=fs::remove_file(&temporary); return Err("PowerPoint conversion timed out".into()); }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        }
        #[cfg(target_os="macos")] convert_mac(source,&temporary)?;
        temporary.clone()
    } else { return Err("Select a PDF or PowerPoint file".into()); };
    let result = (|| {
        if fs::metadata(&pdf).map_err(|e|e.to_string())?.len() > 256 * 1024 * 1024 { return Err("PDF exceeds the 256 MB import limit".into()); }
        let bytes=fs::read(&pdf).map_err(|e|e.to_string())?;
        if !bytes.starts_with(b"%PDF-") { return Err("Invalid PDF document".into()); }
        Ok(bytes)
    })();
    if pdf == temporary { let _=fs::remove_file(&temporary); }
    result
}

#[tauri::command]
pub async fn document_pdf(caller: Webview, path: String) -> Result<tauri::ipc::Response, String> {
    if caller.label() != "main" || caller.label() != caller.window().label() { return Err("Import documents in the editor".into()); }
    let bytes = tauri::async_runtime::spawn_blocking(move || document_bytes(Path::new(&path))).await.map_err(|e|e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

fn extract(source: &Path, destination: &Path) -> Result<Value, String> {
    let mut archive = zip::ZipArchive::new(fs::File::open(source).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Invalid PPTX archive: {e}"))?;
    if archive.len() > 10000 {
        return Err("Presentation contains too many archive entries".into());
    }
    if archive.by_name("ppt/presentation.xml").is_err() {
        return Err("This file is not a PowerPoint PPTX presentation".into());
    }
    let mut xml = Map::new();
    let mut paths = Map::new();
    let mut total = 0_u64;
    let mut xml_total = 0_u64;
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let safe = entry
            .enclosed_name()
            .ok_or("Archive entry escapes its destination")?
            .to_owned();
        let name = entry.name().replace('\\', "/");
        let is_xml = name.ends_with(".xml") || name.ends_with(".rels");
        let is_media = name.starts_with("ppt/media/") || name.starts_with("ppt/fonts/");
        if !is_xml && !is_media {
            continue;
        }
        let size = entry.size();
        total = total.checked_add(size).ok_or("Archive size overflow")?;
        if total > 1024 * 1024 * 1024 || size > 512 * 1024 * 1024 {
            return Err("Presentation exceeds the 1 GB extracted-content limit".into());
        }
        if is_xml {
            xml_total += size;
            if size > 16 * 1024 * 1024 || xml_total > 64 * 1024 * 1024 {
                return Err("Presentation XML exceeds the text limit".into());
            }
            let mut text = String::new();
            entry
                .take(size + 1)
                .read_to_string(&mut text)
                .map_err(|e| e.to_string())?;
            if text.len() as u64 > size {
                return Err("Archive entry exceeds its declared size".into());
            }
            xml.insert(name, json!(text.trim_start_matches('\u{feff}')));
        } else {
            if entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
            {
                return Err("Archive symlinks are not supported".into());
            }
            let target = destination.join(safe);
            fs::create_dir_all(target.parent().ok_or("Invalid media path")?)
                .map_err(|e| e.to_string())?;
            let mut output = fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&target)
                .map_err(|e| e.to_string())?;
            let copied =
                std::io::copy(&mut entry.take(size + 1), &mut output).map_err(|e| e.to_string())?;
            output.flush().map_err(|e| e.to_string())?;
            if copied > size {
                return Err("Archive media exceeds its declared size".into());
            }
            paths.insert(name, json!(target));
        }
    }
    Ok(json!({"xml":xml,"contentPaths":paths}))
}
#[tauri::command]
pub async fn import_powerpoint(
    caller: Webview,
    library: State<'_, Library>,
    path: String,
) -> Result<Value, String> {
    if caller.label() != "main" || caller.label() != caller.window().label() {
        return Err("Import presentations in the editor".into());
    }
    let source = std::path::PathBuf::from(path);
    if !source.is_absolute() {
        return Err("Absolute presentation path required".into());
    }
    if !source
        .extension()
        .and_then(|s| s.to_str())
        .is_some_and(|s| s.eq_ignore_ascii_case("pptx"))
    {
        return Err("Save older .ppt presentations as .pptx before importing".into());
    }
    let destination = library
        .root
        .join("Imports")
        .join("PowerPoint")
        .join(uuid::Uuid::new_v4().to_string());
    tauri::async_runtime::spawn_blocking(move || {
        fs::create_dir_all(&destination).map_err(|e| e.to_string())?;
        match extract(&source, &destination) {
            Ok(result) => Ok(result),
            Err(error) => {
                let _ = fs::remove_dir_all(&destination);
                Err(error)
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pdf_bytes_validate_header_and_preserve_source() {
        let file = std::env::temp_dir().join(format!("{}.pdf", uuid::Uuid::new_v4()));
        fs::write(&file, b"%PDF-1.7\nfixture").unwrap();
        assert_eq!(document_bytes(&file).unwrap(), b"%PDF-1.7\nfixture");
        assert!(file.exists());
        fs::write(&file, b"not a PDF").unwrap();
        assert!(document_bytes(&file).is_err());
        fs::remove_file(file).unwrap();
    }
    #[test]
    #[ignore = "Requires installed PowerPoint and FREESHOW_TEST_PPTX"]
    fn supplied_powerpoint_renders_to_pdf() {
        let source = std::path::PathBuf::from(std::env::var("FREESHOW_TEST_PPTX").unwrap());
        let bytes = document_bytes(&source).unwrap();
        assert!(bytes.starts_with(b"%PDF-"));
        if let Ok(out) = std::env::var("FREESHOW_TEST_PDF_RESULT") { fs::write(out, bytes).unwrap(); }
    }
    #[test]
    #[ignore = "Requires FREESHOW_TEST_PPTX pointing to a read-only real presentation"]
    fn supplied_powerpoint_extracts_slides_and_media() {
        let source = std::path::PathBuf::from(std::env::var("FREESHOW_TEST_PPTX").unwrap());
        let folder = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&folder).unwrap();
        let result = extract(&source, &folder).unwrap();
        let slides = result["xml"]
            .as_object()
            .unwrap()
            .keys()
            .filter(|p| p.starts_with("ppt/slides/slide") && p.ends_with(".xml"))
            .count();
        assert!(slides > 0);
        assert!(!result["contentPaths"].as_object().unwrap().is_empty());
        for p in result["contentPaths"].as_object().unwrap().values() {
            assert!(Path::new(p.as_str().unwrap()).is_file());
        }
        println!(
            "Extracted {slides} slides and {} media/font entries",
            result["contentPaths"].as_object().unwrap().len()
        );
        if let Ok(out) = std::env::var("FREESHOW_TEST_PPTX_RESULT") {
            fs::write(out, serde_json::to_vec(&result).unwrap()).unwrap();
        } else {
            fs::remove_dir_all(folder).unwrap();
        }
    }
}

#[cfg(target_os="macos")]
fn convert_mac(source:&Path,destination:&Path)->Result<(),String>{
 use std::{path::PathBuf,process::{Command,Stdio},time::{Duration,Instant}};
 let executable=["/Applications/LibreOffice.app/Contents/MacOS/soffice","/opt/homebrew/bin/soffice","/usr/local/bin/soffice"].into_iter().map(PathBuf::from).find(|path|path.is_file()).ok_or("For PDF-style PowerPoint import on macOS, install LibreOffice, or export the presentation to PDF first. Editable PPTX import is available without it.")?;
 struct Temporary(PathBuf);impl Drop for Temporary{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
 let folder=Temporary(std::env::temp_dir().join(format!("freeshow-office-{}",uuid::Uuid::new_v4())));fs::create_dir(&folder.0).map_err(|e|e.to_string())?;
 let profile=folder.0.join("profile");let profile=tauri::Url::from_directory_path(&profile).map_err(|_|"Invalid office profile path")?;
 let mut child=Command::new(executable).arg(format!("-env:UserInstallation={profile}")).args(["--headless","--nologo","--nodefault","--norestore","--convert-to","pdf:impress_pdf_Export","--outdir"]).arg(&folder.0).arg(source).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|e|e.to_string())?;
 let start=Instant::now();loop{if let Some(status)=child.try_wait().map_err(|e|e.to_string())?{if !status.success(){return Err("LibreOffice could not convert this presentation. Export it to PDF in PowerPoint and import that file.".into())}break}if start.elapsed()>Duration::from_secs(180){let _=child.kill();let _=child.wait();return Err("PowerPoint conversion timed out".into())}std::thread::sleep(Duration::from_millis(100));}
 let result=folder.0.join(source.file_stem().ok_or("Missing document name")?).with_extension("pdf");fs::copy(result,destination).map_err(|e|format!("Presentation PDF was not created: {e}"))?;Ok(())
}
