use serde_json::{json, Value};
use std::{collections::HashMap, fs, io::Read, path::{Path, PathBuf}};

fn hash(path: &str) -> String {
    let value = path.encode_utf16().fold(0_i32, |hash, unit| hash.wrapping_mul(31).wrapping_add(unit as i32));
    if value < 0 { format!("i{}", -(value as i64)) } else { format!("a{value}") }
}
fn archive_name(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let file = normalized.rsplit('/').next().unwrap_or("media");
    let (stem, extension) = file.rsplit_once('.').map(|(s,e)| (s,format!(".{e}"))).unwrap_or((file,String::new()));
    format!("{stem}__{}{extension}", hash(path))
}
fn non_file_reference(path:&str)->bool{let lower=path.to_ascii_lowercase();path.is_empty()||["data:","http://","https://","blob:","freeshow-protected://"].iter().any(|prefix|lower.starts_with(prefix))}

fn rewrite(value: Value, paths: &HashMap<String, String>) -> Value {
    match value {
        Value::String(value) => Value::String(paths.get(&value).cloned().unwrap_or(value)),
        Value::Array(values) => Value::Array(values.into_iter().map(|v| rewrite(v,paths)).collect()),
        Value::Object(values) => Value::Object(values.into_iter().map(|(k,v)| (paths.get(&k).cloned().unwrap_or(k),rewrite(v,paths))).collect()),
        other => other
    }
}

pub fn import(root: &Path, source: &Path) -> Result<Value, String> {
    if !source.is_absolute() { return Err("Absolute package path required".into()); }
    let mut file = fs::File::open(source).map_err(|e| e.to_string())?;
    let mut signature = [0_u8;4];
    let count = file.read(&mut signature).map_err(|e| e.to_string())?;
    if count < 4 || signature != [80,75,3,4] {
        let content = super::library_services::bounded_text(source)?;
        serde_json::from_str::<Value>(&content).map_err(|e| format!("Invalid FreeShow file: {e}"))?;
        return Ok(json!({"content":content}));
    }
    let mut archive = zip::ZipArchive::new(fs::File::open(source).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    if archive.len() > 20000 { return Err("Package has too many entries".into()); }
    let mut entry = archive.by_name("data.json").map_err(|_| "FreeShow package has no data.json")?;
    if entry.size() > 64*1024*1024 { return Err("Package metadata exceeds 64 MB".into()); }
    let mut bytes = Vec::new();
    (&mut entry).take(64*1024*1024+1).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
    if bytes.len()>64*1024*1024 { return Err("Package metadata exceeds 64 MB".into()); }
    let data: Value = serde_json::from_slice(&bytes).map_err(|e|e.to_string())?;
    drop(entry);
    let folder = root.join("Imports/Packages").join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&folder).map_err(|e|e.to_string())?;
    let result = (|| {
        let mut paths = HashMap::new();
        let mut total=0_u64;
        if let Some(files) = data["files"].as_array() {
            for original in files {
                let Some(original)=original.as_str()else{continue};
                if non_file_reference(original){continue}
                let normalized=original.replace('\\',"/");
                let basename=normalized.rsplit('/').next().ok_or("Invalid media filename")?;
                let hashed=archive_name(original);
                // Match both modern hashed packages and older filename-only packages.
                let name=if archive.file_names().any(|n|n==hashed) { hashed } else { basename.to_owned() };
                let mut entry=archive.by_name(&name).map_err(|_|format!("Bundled media missing: {basename}"))?;
                if entry.enclosed_name().is_none() || entry.is_dir() { return Err("Invalid bundled media path".into()); }
                total+=entry.size();
                if total>8*1024*1024*1024 { return Err("Bundled media exceeds 8 GB".into()); }
                // Destination is generated locally; archive paths are never extracted.
                let destination=folder.join(format!("{}-{}",uuid::Uuid::new_v4(), super::library_services::file_name(basename)));
                let mut output=fs::OpenOptions::new().write(true).create_new(true).open(&destination).map_err(|e|e.to_string())?;
                let expected=entry.size();
                let copied=std::io::copy(&mut (&mut entry).take(expected+1),&mut output).map_err(|e|e.to_string())?;
                if copied!=expected { return Err("Bundled media size mismatch".into()); }
                let destination=destination.to_string_lossy().replace('\\',"/");
                for variant in [original.to_owned(),normalized.clone(),normalized.replace('/',"\\")] { paths.insert(variant,destination.clone()); }
            }
        }
        let mut data = rewrite(data, &paths);
        if let Some(object)=data.as_object_mut(){ object.remove("files"); }
        Ok(json!({"content":serde_json::to_string(&data).map_err(|e|e.to_string())?}))
    })();
    if result.is_err() { let _=fs::remove_dir_all(&folder); }
    result
}

pub fn export(folder: &Path, name: &str, extension: &str, payload: &Value, requested: Option<&str>) -> Result<PathBuf, String> {
    let files:Vec<Value>=payload["files"].as_array().cloned().unwrap_or_default().into_iter().filter(|value|!value.as_str().is_some_and(non_file_reference)).collect();
    let destination = if let Some(requested)=requested.filter(|s|!s.is_empty()) {
        let path=PathBuf::from(requested);
        if !path.is_absolute() { return Err("Export destination must be absolute".into()); }
        if path.is_dir() { return export(&path,name,extension,payload,None); }
        path.with_extension(extension)
    } else {
        fs::create_dir_all(folder).map_err(|e|e.to_string())?;
        let base=super::library_services::file_name(name);
        let mut number=0;
        loop {
            let suffix=if number==0 {String::new()} else {format!(" ({number})")};
            let path=folder.join(format!("{base}{suffix}.{extension}"));
            if !path.exists(){break path;}
            number+=1;
            if number>=10000{return Err("Too many exports with this name".into());}
        }
    };
    fs::create_dir_all(destination.parent().ok_or("Invalid export path")?).map_err(|e|e.to_string())?;
    let temporary=destination.with_extension(format!("{}.partial",uuid::Uuid::new_v4()));
    let result=(|| {
        let mut output=fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|e|e.to_string())?;
        if files.is_empty() {
            let mut payload=payload.clone();
            if let Some(object)=payload.as_object_mut(){object.remove("files");}
            serde_json::to_writer_pretty(&mut output,&payload).map_err(|e|e.to_string())?;
            output.sync_all().map_err(|e|e.to_string())?;
            drop(output);
        } else {
            let mut archive=zip::ZipWriter::new(output);
            let options=zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            let mut names=std::collections::HashSet::new();
            for path in &files {
                let path=path.as_str().ok_or("Invalid export media reference")?;
                let name=archive_name(path);
                if !names.insert(name.clone()){continue;}
                let mut source=fs::File::open(path).map_err(|e|format!("Cannot bundle {path}: {e}"))?;
                archive.start_file(name,options).map_err(|e|e.to_string())?;
                std::io::copy(&mut source,&mut archive).map_err(|e|e.to_string())?;
            }
            archive.start_file("data.json",options).map_err(|e|e.to_string())?;
            serde_json::to_writer(&mut archive,payload).map_err(|e|e.to_string())?;
            archive.finish().map_err(|e|e.to_string())?.sync_all().map_err(|e|e.to_string())?;
        }
        fs::rename(&temporary,&destination).map_err(|e|e.to_string())?;
        Ok(destination.clone())
    })();
    if result.is_err(){let _=fs::remove_file(temporary);}
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn project_packages_preserve_embedded_and_remote_media_references() {
        let root=std::env::temp_dir().join(format!("freeshow-package-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let local=root.join("local.png");fs::write(&local,b"local image").unwrap();
        let references=vec!["data:image/png;base64,aGVsbG8=","https://example.invalid/image.png","blob:fixture","freeshow-protected://fixture"];
        let mut files:Vec<Value>=references.iter().map(|value|json!(value)).collect();files.push(json!(local.to_str().unwrap()));
        let payload=json!({"project":{"name":"Mixed"},"files":files,"images":references,"local":local.to_str().unwrap()});
        let exported=export(&root,"Mixed","project",&payload,None).unwrap();
        let imported=import(&root,&exported).unwrap();
        let restored:Value=serde_json::from_str(imported["content"].as_str().unwrap()).unwrap();
        assert_eq!(restored["images"],payload["images"]);
        assert_eq!(fs::read(restored["local"].as_str().unwrap()).unwrap(),b"local image");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn bundled_project_roundtrip_rewrites_media_and_honors_destination() {
        let root=std::env::temp_dir().join(format!("freeshow-package-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let media=root.join("photo.png");fs::write(&media,b"image bytes").unwrap();
        let original=media.to_string_lossy().into_owned();
        let payload=json!({"project":{"name":"Test"},"files":[original],"shows":{"one":{"src":original}},"media":{original.clone():{"fit":"fill"}}});
        let destination=root.join("Chosen/Exact.project");
        let result=export(&root.join("Exports"),"Ignored","project",&payload,Some(destination.to_str().unwrap())).unwrap();
        assert_eq!(result,destination);
        let imported=import(&root,&result).unwrap();
        let data:Value=serde_json::from_str(imported["content"].as_str().unwrap()).unwrap();
        let restored=data["shows"]["one"]["src"].as_str().unwrap();
        assert_ne!(restored,original);assert_eq!(fs::read(restored).unwrap(),b"image bytes");
        assert!(data["media"][restored].is_object());
        assert!(data.get("files").is_none());
        fs::remove_dir_all(root).unwrap();
    }
}
