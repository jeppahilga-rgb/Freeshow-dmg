#[tauri::command]
pub async fn spotify_service(command: String, value: Option<f64>) -> Result<serde_json::Value, String> {
    #[cfg(windows)]
    return tauri::async_runtime::spawn_blocking(move || service(&command, value))
        .await.map_err(|e| e.to_string())?.map_err(|e| e.to_string());
    #[cfg(not(windows))]
    { let _ = (command, value); Ok(serde_json::Value::Null) }
}

#[cfg(windows)]
fn service(command: &str, value: Option<f64>) -> windows::core::Result<serde_json::Value> {
    use windows::Media::Control::{GlobalSystemMediaTransportControlsSessionManager as Manager, GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status};
    use windows::Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED};
    // Thread-pool threads may already have a COM apartment.
    struct Apartment(bool);
    impl Drop for Apartment { fn drop(&mut self) { if self.0 { unsafe { RoUninitialize() }; } } }
    let _apartment = Apartment(unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.is_ok());
    let sessions = Manager::RequestAsync()?.join()?.GetSessions()?;
    let mut selected = None;
    for session in sessions {
        if session.SourceAppUserModelId()?.to_string().to_lowercase().contains("spotify") {
            selected = Some(session); break;
        }
    }
    let Some(session) = selected else { return Ok(serde_json::Value::Null); };
    if command != "state" {
        let accepted = match command {
            "playpause" => session.TryTogglePlayPauseAsync()?.join()?,
            "play" => session.TryPlayAsync()?.join()?,
            "pause" => session.TryPauseAsync()?.join()?,
            "next" => session.TrySkipNextAsync()?.join()?,
            "prev" => session.TrySkipPreviousAsync()?.join()?,
            "seek" => {
                let seconds = value.filter(|v| v.is_finite() && *v >= 0.0)
                    .ok_or_else(|| windows::core::Error::from_hresult(windows::core::HRESULT(0x80070057u32 as i32)))?;
                session.TryChangePlaybackPositionAsync((seconds.min(86400.0) * 10_000_000.0) as i64)?.join()?
            },
            _ => return Err(windows::core::Error::from_hresult(windows::core::HRESULT(0x80070057u32 as i32))),
        };
        return Ok(serde_json::json!({"accepted": accepted}));
    }
    let media = session.TryGetMediaPropertiesAsync()?.join()?;
    let timeline = session.GetTimelineProperties()?;
    Ok(serde_json::json!({
        "title":media.Title()?.to_string(), "artist":media.Artist()?.to_string(),
        "isPlaying":session.GetPlaybackInfo()?.PlaybackStatus()? == Status::Playing,
        "positionSec":timeline.Position()?.Duration as f64 / 10_000_000.0,
        "durationSec":(timeline.EndTime()?.Duration - timeline.StartTime()?.Duration).max(0) as f64 / 10_000_000.0,
        "platform":"win32", "volume":1.0, "canSetVolume":false
    }))
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn reads_windows_spotify_session_without_controlling_other_players() {
        let state = super::service("state", None).expect("Windows media session service");
        assert!(state.is_null() || state["platform"] == "win32");
    }
}

