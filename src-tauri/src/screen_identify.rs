use tauri::{Manager,WebviewWindowBuilder,WebviewUrl};
pub fn identify(app:&tauri::AppHandle)->Result<(),String>{
 let editor=app.get_window("main").ok_or("Editor is closed")?;let monitors=editor.available_monitors().map_err(|e|e.to_string())?;
 for (index,monitor)in monitors.iter().enumerate(){let label=format!("identify-{}",index+1);if let Some(old)=app.get_window(&label){let _=old.close();}let url=reqwest::Url::parse(&format!("data:text/html,<html><body style='margin:0;background:%23161620;color:white;font:160px Segoe UI;display:grid;place-items:center;height:100vh'>{}</body></html>",index+1)).map_err(|e|e.to_string())?;let window=WebviewWindowBuilder::new(app,&label,WebviewUrl::External(url)).title("Identify FreeShow display").decorations(false).shadow(false).always_on_top(true).focused(false).skip_taskbar(true).build().map_err(|e|e.to_string())?;window.set_position(*monitor.position()).map_err(|e|e.to_string())?;window.set_size(*monitor.size()).map_err(|e|e.to_string())?;let app=app.clone();tauri::async_runtime::spawn(async move{tokio::time::sleep(std::time::Duration::from_secs(3)).await;if let Some(window)=app.get_window(&label){let _=window.close();}});
 }Ok(())
}
