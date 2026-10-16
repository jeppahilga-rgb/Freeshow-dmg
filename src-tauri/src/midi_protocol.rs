use serde_json::{json,Value};
pub fn message(kind:&str,values:&Value)->Result<u32,String>{
    let channel=values["channel"].as_u64().unwrap_or(1);if !(1..=16).contains(&channel){return Err("MIDI channel must be 1–16".into());}
    let (status,a,b)=match kind{"control"=>(0xb0,values["controller"].as_u64().unwrap_or(0),values["value"].as_u64().unwrap_or(0)),"noteoff"=>(0x80,values["note"].as_u64().unwrap_or(0),values["velocity"].as_u64().unwrap_or(0)),"noteon"=>(0x90,values["note"].as_u64().unwrap_or(0),values["velocity"].as_u64().unwrap_or(0)),_=>return Err("Unknown MIDI message type".into())};
    if a>127||b>127{return Err("MIDI data must be 0–127".into());}Ok(status|(channel as u32-1)|(a as u32)<<8|(b as u32)<<16)
}
pub fn decode(id:&str,packed:u32)->Option<Value>{let status=packed&0xff;let a=(packed>>8)&0x7f;let b=(packed>>16)&0x7f;let channel=(status&0xf)+1;match status&0xf0{0x80|0x90=>Some(json!({"id":id,"type":if status&0xf0==0x90&&b>0{"noteon"}else{"noteoff"},"values":{"note":a,"velocity":b,"channel":channel}})),0xb0=>Some(json!({"id":id,"type":"control","values":{"controller":a,"value":b,"channel":channel}})),_=>None}}
#[cfg(test)]mod tests{use super::*;
    #[test]fn channels_and_note_off_velocity(){let bytes=message("noteon",&json!({"channel":16,"note":60,"velocity":0})).unwrap();let decoded=decode("test",bytes).unwrap();assert_eq!(decoded["values"]["channel"],16);assert_eq!(decoded["type"],"noteoff");assert!(message("noteon",&json!({"channel":17})).is_err());assert!(message("control",&json!({"controller":128})).is_err());}
}
