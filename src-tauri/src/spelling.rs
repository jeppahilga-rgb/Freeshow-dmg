use serde_json::{json,Value};
#[cfg(windows)] pub fn check(data:&Value)->Result<Value,String>{
 use windows::{core::{PCWSTR,PWSTR},Win32::{Globalization::{ISpellCheckerFactory,SpellCheckerFactory},System::Com::*}};
 let word=data["word"].as_str().ok_or("Missing spelling word")?;if word.is_empty()||word.chars().count()>256{return Err("Invalid spelling word".into());}let language=data["language"].as_str().unwrap_or("en-US");if language.len()>64||!language.chars().all(|c|c.is_ascii_alphanumeric()||c=='-'){return Err("Invalid spelling language".into());}
 struct Apartment(bool);impl Drop for Apartment{fn drop(&mut self){if self.0{unsafe{CoUninitialize()}}}}
 let _apartment=Apartment(unsafe{CoInitializeEx(None,COINIT_MULTITHREADED)}.is_ok());
 let word=word.encode_utf16().chain(Some(0)).collect::<Vec<_>>();let language=language.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
 unsafe{let factory:ISpellCheckerFactory=CoCreateInstance(&SpellCheckerFactory,None,CLSCTX_INPROC_SERVER).map_err(|e|e.to_string())?;if !factory.IsSupported(PCWSTR(language.as_ptr())).map_err(|e|e.to_string())?.as_bool(){return Ok(json!({"supported":false,"suggestions":[]}));}let checker=factory.CreateSpellChecker(PCWSTR(language.as_ptr())).map_err(|e|e.to_string())?;if data["action"].as_str()==Some("add"){checker.Add(PCWSTR(word.as_ptr())).map_err(|e|e.to_string())?;return Ok(Value::Null)}let errors=checker.Check(PCWSTR(word.as_ptr())).map_err(|e|e.to_string())?;let mut error=None;let _=errors.Next(&mut error);if error.is_none(){return Ok(json!({"supported":true,"misspelled":false,"suggestions":[]}));}let enumerator=checker.Suggest(PCWSTR(word.as_ptr())).map_err(|e|e.to_string())?;let mut suggestions=Vec::new();for _ in 0..8{let mut result=[PWSTR::null()];let mut count=0;let status=enumerator.Next(&mut result,Some(&mut count));if status.is_err()||count==0{break}if !result[0].is_null(){let value=result[0].to_string().unwrap_or_default();CoTaskMemFree(Some(result[0].0 as *const _));if !value.is_empty(){suggestions.push(value)}}}Ok(json!({"supported":true,"misspelled":true,"suggestions":suggestions}))}
}
#[cfg(target_os="macos")]pub fn check(data:&Value)->Result<Value,String>{
 use std::{process::{Command,Stdio},io::Write};
 let word=data["word"].as_str().ok_or("Missing spelling word")?;if word.is_empty()||word.chars().count()>256{return Err("Invalid spelling word".into())}
 let mut child=Command::new(crate::native_capture::helper()?).arg("spell").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e|e.to_string())?;
 child.stdin.take().ok_or("Spellchecker input unavailable")?.write_all(&serde_json::to_vec(data).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
 let result=child.wait_with_output().map_err(|e|e.to_string())?;if !result.status.success(){return Err("macOS spellchecker unavailable".into())}serde_json::from_slice(&result.stdout).map_err(|e|e.to_string())
}
