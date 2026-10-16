use crate::midi_protocol::{decode, message};
use midir::{MidiInput, MidiInputConnection, MidiOutput, MidiOutputConnection};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Mutex};
use tauri::{Emitter, State};
#[derive(Default)]
pub struct Midi {
    inputs: Mutex<HashMap<String, MidiInputConnection<()>>>,
    outputs: Mutex<HashMap<String, MidiOutputConnection>>,
}
impl Midi {
    pub fn stop(&self) {
        self.inputs.lock().unwrap().clear();
        self.outputs.lock().unwrap().clear();
    }
}
impl Drop for Midi { fn drop(&mut self) { self.stop(); } }
#[tauri::command]
pub fn midi_service(app: tauri::AppHandle, caller: tauri::Webview, state: State<'_, Midi>, operation: String, data: Value) -> Result<Value, String> {
    if caller.label() != "main" || caller.label() != caller.window().label() { return Err("MIDI belongs to the editor".into()); }
    match operation.as_str() {
        "GET_MIDI_INPUTS" => {
            let midi = MidiInput::new("FreeShow+ inputs").map_err(|e| e.to_string())?;
            Ok(json!(midi.ports().iter().filter_map(|p| midi.port_name(p).ok()).map(|name| json!({"name":name})).collect::<Vec<_>>()))
        }
        "GET_MIDI_OUTPUTS" => {
            let midi = MidiOutput::new("FreeShow+ outputs").map_err(|e| e.to_string())?;
            Ok(json!(midi.ports().iter().filter_map(|p| midi.port_name(p).ok()).map(|name| json!({"name":name})).collect::<Vec<_>>()))
        }
        "SEND_MIDI" => {
            let target = data["output"].as_str().ok_or("Select a MIDI output")?;
            let packed = message(data["type"].as_str().unwrap_or("noteon"), &data["values"])?;
            let mut ports = state.outputs.lock().unwrap();
            if !ports.contains_key(target) {
                let midi = MidiOutput::new("FreeShow+ output").map_err(|e| e.to_string())?;
                let port = midi.ports().into_iter().find(|p| midi.port_name(p).is_ok_and(|n| n == target)).ok_or("MIDI output not found")?;
                let connection = midi.connect(&port, "FreeShow+ output").map_err(|e| e.to_string())?;
                ports.insert(target.to_owned(), connection);
            }
            ports.get_mut(target).unwrap().send(&packed.to_le_bytes()[..3]).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "RECEIVE_MIDI" => {
            let id = data["id"].as_str().ok_or("Missing MIDI listener ID")?;
            let target = data["input"].as_str().ok_or("Select a MIDI input")?;
            let mut ports = state.inputs.lock().unwrap();
            if ports.contains_key(id) { return Ok(Value::Null); }
            let midi = MidiInput::new("FreeShow+ input").map_err(|e| e.to_string())?;
            let port = midi.ports().into_iter().find(|p| midi.port_name(p).is_ok_and(|n| n == target)).ok_or("MIDI input not found")?;
            let listener = id.to_owned();
            let connection = midi.connect(&port, "FreeShow+ input", move |_, bytes, _| {
                if bytes.len() != 3 { return; }
                let packed = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], 0]);
                if let Some(data) = decode(&listener, packed) {
                    let _ = app.emit_to("main", "freeshow-ipc", json!({"channel":"MAIN","msg":{"channel":"RECEIVE_MIDI2","data":data}}));
                }
            }, ()).map_err(|e| e.to_string())?;
            ports.insert(id.to_owned(), connection);
            Ok(Value::Null)
        }
        "CLOSE_MIDI" => {
            let id = data["id"].as_str().unwrap_or("");
            if id.is_empty() { state.stop(); } else { state.inputs.lock().unwrap().remove(id); }
            Ok(Value::Null)
        }
        _ => Err("Unknown MIDI operation".into()),
    }
}

