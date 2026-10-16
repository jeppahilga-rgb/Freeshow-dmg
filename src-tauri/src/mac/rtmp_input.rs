#[derive(Default)] pub struct RtmpInput;
impl RtmpInput{pub fn stop(&self){}}
#[tauri::command] pub async fn rtmp_input_start()->Result<serde_json::Value,String>{Err("The ARM MediaMTX receiver is not bundled in this Mac core preview.".into())}
#[tauri::command] pub fn rtmp_input_stop(){}
#[tauri::command] pub async fn rtmp_input_request(id:String,action:String,sdp:Option<String>,session:Option<String>)->Result<serde_json::Value,String>{Err("RTMP input is unavailable in this Mac core preview.".into())}
