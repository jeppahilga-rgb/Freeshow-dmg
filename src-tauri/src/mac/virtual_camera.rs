#[derive(Default)] pub struct VirtualCamera;
#[tauri::command]
pub async fn virtual_camera(window:tauri::Window,action:String,output:Option<String>)->Result<serde_json::Value,String>{
 if window.label()!="main"{return Err("Editor only".into())}let _=output;
 if action=="status"||action=="stop"{return Ok(serde_json::json!({"running":false,"supported":false,"reason":"FreeShow Virtual Camera requires an Apple-signed macOS camera extension. This preview does not include one.","name":"FreeShow Virtual Camera"}))}
 Err("FreeShow Virtual Camera needs a signed macOS camera extension; it is not included in this preview.".into())
}
