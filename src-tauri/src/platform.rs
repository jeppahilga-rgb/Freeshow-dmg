use std::path::{Path, PathBuf};
#[cfg(not(windows))] use std::process::Command;

pub fn node_name(windows: bool) -> &'static str { if windows { "node.exe" } else { "node" } }
pub fn open_target(target: impl AsRef<std::ffi::OsStr>, url: bool) -> Result<(), String> {
    #[cfg(windows)] let mut command = if url { let mut command = crate::desktop_services::hidden("rundll32.exe"); command.arg("url.dll,FileProtocolHandler"); command } else { crate::desktop_services::hidden("explorer.exe") };
    #[cfg(target_os="macos")] let mut command = Command::new("/usr/bin/open");
    #[cfg(not(any(windows,target_os="macos")))] let mut command = Command::new("xdg-open");
    let _ = url;
    command.arg(target).spawn().map_err(|e|e.to_string())?;
    Ok(())
}
pub fn runtime_folder(executable: &Path, resources: Option<&Path>) -> PathBuf {
    resources.map(|root| root.join("runtime")).unwrap_or_else(|| executable.parent().unwrap_or(Path::new(".")).join("runtime"))
}
pub fn memory() -> Result<serde_json::Value,String> {
    #[cfg(windows)] {
        use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx,MEMORYSTATUSEX};
        let mut m=MEMORYSTATUSEX::default(); m.dwLength=std::mem::size_of_val(&m) as u32;
        unsafe { GlobalMemoryStatusEx(&mut m).map_err(|e|e.to_string())?; }
        return Ok(serde_json::json!({"total":m.ullTotalPhys,"free":m.ullAvailPhys,"performanceMode":m.dwMemoryLoad>=90}));
    }
    #[cfg(target_os="macos")] {
        let total=Command::new("/usr/sbin/sysctl").args(["-n","hw.memsize"]).output().map_err(|e|e.to_string())?;
        let pages=Command::new("/usr/bin/vm_stat").output().map_err(|e|e.to_string())?;
        if !total.status.success() || !pages.status.success() { return Err("macOS memory information is unavailable".into()); }
        return parse_mac_memory(&String::from_utf8_lossy(&total.stdout), &String::from_utf8_lossy(&pages.stdout));
    }
    #[cfg(not(any(windows,target_os="macos")))] Err("Memory information is unavailable on this platform".into())
}
#[cfg(any(target_os="macos",test))]
fn parse_mac_memory(total:&str, pages:&str)->Result<serde_json::Value,String>{
    let total=total.trim().parse::<u64>().map_err(|_|"Invalid macOS memory total")?;
    let page_size=pages.lines().next().and_then(|line|line.split("page size of ").nth(1)).and_then(|value|value.split_whitespace().next()).and_then(|value|value.parse::<u64>().ok()).filter(|size|*size>0).ok_or("Invalid macOS page size")?;
    let mut available=0u64; let mut found=false;
    for line in pages.lines().skip(1){if let Some((name,value))=line.split_once(':'){if ["Pages free","Pages inactive","Pages speculative"].contains(&name.trim()) {let count=value.trim().trim_end_matches('.').parse::<u64>().map_err(|_|"Invalid macOS page count")?;available=available.saturating_add(count);found=true;}}}
    if !found || total==0{return Err("Missing macOS memory statistics".into())}
    let free=available.saturating_mul(page_size).min(total);
    Ok(serde_json::json!({"total":total,"free":free,"performanceMode":free<total/10}))
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn executable_names_and_bundle_paths(){assert_eq!(node_name(true),"node.exe");assert_eq!(node_name(false),"node");assert_eq!(runtime_folder(Path::new("app/bin"),Some(Path::new("bundle/Resources"))),PathBuf::from("bundle/Resources/runtime"));assert_eq!(runtime_folder(Path::new("app/bin"),None),PathBuf::from("app/runtime"));}
    #[test] fn mac_memory_uses_reported_arm_page_size(){let value=parse_mac_memory("16777216\n","Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 10.\nPages inactive: 20.\nPages speculative: 5.\n").unwrap();assert_eq!(value["free"],35*16384);assert_eq!(value["performanceMode"],true);}
    #[test] fn mac_memory_rejects_missing_or_invalid_statistics(){assert!(parse_mac_memory("0","bad").is_err());assert!(parse_mac_memory("10000","page size of 4096 bytes\nPages wired down: 2.").is_err());}
}
