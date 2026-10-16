#[derive(Default)] pub struct Midi;
impl Midi{pub fn stop(&self){}}
#[tauri::command]
pub fn midi_service(caller:tauri::Webview,operation:String,data:serde_json::Value)->Result<serde_json::Value,String>{
 if caller.label()!="main"||caller.label()!=caller.window().label(){return Err("Editor only".into())}let _=(operation,data);
 Err("CoreMIDI is not yet available in this Mac core preview.".into())
}
