use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{ipc::Response, Manager, State, Window as AppWindow};
use windows_capture::{
    capture::{CaptureControl, Context, GraphicsCaptureApiHandler},
    frame::Frame,
    graphics_capture_api::InternalCaptureControl,
    monitor::Monitor,
    settings::*,
    window::Window,
};

type CaptureError = Box<dyn std::error::Error + Send + Sync>;

fn encode_frame(rgba: image::RgbaImage, thumbnail: bool) -> Result<Vec<u8>, image::ImageError> {
    let image = image::DynamicImage::ImageRgba8(rgba);
    // Only source-picker thumbnails may lose resolution. Live captures must retain
    // their physical pixels, including HiDPI and 4K windows, for output cropping/zoom.
    let image = if thumbnail { image.thumbnail(320, 180) } else { image };
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(
        &mut jpeg, if thumbnail { 70 } else { 98 },
    ).encode_image(&image.to_rgb8())?;
    Ok(jpeg)
}

fn capture_browser_args(url: &str, profile: &std::path::Path) -> Result<Vec<String>, String> {
    let parsed = tauri::Url::parse(url.trim()).map_err(|_| "Enter a complete http or https website address")?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none()
        || !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Use an http or https website address without credentials".into());
    }
    Ok(vec![
        format!("--user-data-dir={}", profile.display()),
        "--no-first-run".into(), "--no-default-browser-check".into(),
        "--disable-backgrounding-occluded-windows".into(),
        "--disable-renderer-backgrounding".into(),
        "--disable-background-timer-throttling".into(),
        "--disable-features=CalculateNativeWinOcclusion".into(),
        "--window-size=1920,1080".into(),
        "--new-window".into(), parsed.to_string(),
    ])
}

#[tauri::command]
pub fn native_capture_browser(url: String, window: AppWindow) -> Result<(), String> {
    if window.label() != "main" { return Err("Open capture websites in the editor".into()); }
    let profile = window.app_handle().path().app_data_dir().map_err(|e| e.to_string())?.join("capture-browser");
    let args = capture_browser_args(&url, &profile)?;
    let browser = ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"].into_iter()
        .filter_map(std::env::var_os).flat_map(|root| {
            let root = std::path::PathBuf::from(root);
            [root.join("Google/Chrome/Application/chrome.exe"), root.join("Microsoft/Edge/Application/msedge.exe")]
        }).find(|file| file.is_file()).ok_or("Install Chrome or Edge to open a capture browser")?;
    std::fs::create_dir_all(&profile).map_err(|e| e.to_string())?;
    // A separate profile ensures an existing everyday browser cannot absorb this
    // launch and discard the capture-specific rendering options. No shell is used.
    std::process::Command::new(browser).args(args)
        .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
        .spawn().map_err(|e| format!("Could not open capture browser: {e}"))?;
    Ok(())
}
#[derive(Default)]
struct Latest {
    jpeg: Vec<u8>,
    closed: bool,
}
#[derive(Clone)]
struct Flags {
    latest: Arc<Mutex<Latest>>,
    thumbnail: bool,
}
struct Handler {
    flags: Flags,
    last: Instant,
    padding: Vec<u8>,
}
impl GraphicsCaptureApiHandler for Handler {
    type Flags = Flags;
    type Error = CaptureError;
    fn new(ctx: Context<Flags>) -> Result<Self, CaptureError> {
        Ok(Self {
            flags: ctx.flags,
            last: Instant::now() - Duration::from_secs(1),
            padding: Vec::new(),
        })
    }
    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        control: InternalCaptureControl,
    ) -> Result<(), CaptureError> {
        if !self.flags.thumbnail && self.last.elapsed() < Duration::from_millis(40) {
            return Ok(());
        }
        self.last = Instant::now();
        let width = frame.width();
        let height = frame.height();
        let buffer = frame.buffer()?;
        let rgba = image::RgbaImage::from_raw(
            width,
            height,
            buffer.as_nopadding_buffer(&mut self.padding).to_vec(),
        )
        .ok_or("Invalid capture frame")?;
        let jpeg = encode_frame(rgba, self.flags.thumbnail)?;
        self.flags
            .latest
            .lock()
            .map_err(|_| "Capture state unavailable")?
            .jpeg = jpeg;
        if self.flags.thumbnail {
            control.stop();
        }
        Ok(())
    }
    fn on_closed(&mut self) -> Result<(), CaptureError> {
        if let Ok(mut latest) = self.flags.latest.lock() {
            latest.closed = true;
        }
        Ok(())
    }
}
struct Session {
    latest: Arc<Mutex<Latest>>,
    control: CaptureControl<Handler, CaptureError>,
    consumers: HashSet<String>,
}
#[derive(Default, Clone)]
pub struct NativeCapture(Arc<Mutex<HashMap<String, Session>>>);
#[derive(Serialize)]
pub struct Source {
    id: String,
    name: String,
    kind: &'static str,
}

fn begin<T: TryInto<GraphicsCaptureItemType> + Send + 'static>(
    item: T,
    flags: Flags,
) -> Result<CaptureControl<Handler, CaptureError>, String> {
    Handler::start_free_threaded(Settings::new(
        item,
        CursorCaptureSettings::WithoutCursor,
        DrawBorderSettings::Default,
        SecondaryWindowSettings::Default,
        MinimumUpdateIntervalSettings::Default,
        DirtyRegionSettings::Default,
        ColorFormat::Rgba8,
        flags,
    ))
    .map_err(|e| e.to_string())
}
fn start(id: &str, flags: Flags) -> Result<CaptureControl<Handler, CaptureError>, String> {
    if let Some(handle) = id
        .strip_prefix("native-screen-")
        .and_then(|v| v.parse::<usize>().ok())
    {
        let monitor = Monitor::enumerate()
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|m| m.as_raw_hmonitor() as usize == handle)
            .ok_or("Display disconnected. Refresh the source list.")?;
        return begin(monitor, flags);
    }
    if let Some(handle) = id
        .strip_prefix("native-window-")
        .and_then(|v| v.parse::<usize>().ok())
    {
        let window = Window::enumerate()
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|w| w.as_raw_hwnd() as usize == handle)
            .ok_or("Window closed or unavailable. Refresh the source list.")?;
        return begin(window, flags);
    }
    Err("Invalid capture source".into())
}
pub fn window_jpeg(handle:usize)->Result<Vec<u8>,String>{
    let latest=Arc::new(Mutex::new(Latest::default()));let control=begin(Window::from_raw_hwnd(handle as *mut _),Flags{latest:latest.clone(),thumbnail:false})?;
    let started=Instant::now();let bytes=loop{let value=latest.lock().map_err(|_|"Capture state unavailable")?;if !value.jpeg.is_empty(){break value.jpeg.clone()}if value.closed||started.elapsed()>Duration::from_secs(5){break Vec::new()}drop(value);std::thread::sleep(Duration::from_millis(30));};let _=control.stop();if bytes.is_empty(){Err("Slide image was unavailable".into())}else{Ok(bytes)}
}
pub fn window_handle(window:&AppWindow)->Result<usize,String>{Ok(window.hwnd().map_err(|e|e.to_string())?.0 as usize)}
#[tauri::command]
pub fn native_sources(window: AppWindow) -> Result<Vec<Source>, String> {
    if window.label() != "main" {
        return Err("Choose sources in the editor".into());
    }
    let mut sources = Vec::new();
    for (index, monitor) in Monitor::enumerate()
        .map_err(|e| e.to_string())?
        .into_iter()
        .enumerate()
    {
        sources.push(Source {
            id: format!("native-screen-{}", monitor.as_raw_hmonitor() as usize),
            name: format!("Entire screen {}", index + 1),
            kind: "screen",
        });
    }
    for w in Window::enumerate().map_err(|e| e.to_string())? {
        let name = w.title().unwrap_or_default();
        if name.trim().is_empty() || name.starts_with("FreeShow Output —") {
            continue;
        }
        sources.push(Source {
            id: format!("native-window-{}", w.as_raw_hwnd() as usize),
            name,
            kind: "window",
        });
    }
    Ok(sources)
}
#[tauri::command]
pub async fn native_thumbnail(id: String, window: AppWindow) -> Result<Response, String> {
    if window.label() != "main" {
        return Err("Choose sources in the editor".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let latest = Arc::new(Mutex::new(Latest::default()));
        let control = start(
            &id,
            Flags {
                latest: latest.clone(),
                thumbnail: true,
            },
        )?;
        let started = Instant::now();
        let bytes = loop {
            let image = latest.lock().map_err(|_| "Capture state unavailable")?;
            if !image.jpeg.is_empty() {
                break image.jpeg.clone();
            }
            if image.closed || started.elapsed() > Duration::from_secs(4) {
                break Vec::new();
            }
            drop(image);
            std::thread::sleep(Duration::from_millis(30));
        };
        let _ = control.stop();
        if bytes.is_empty() {
            return Err("Preview unavailable; the window may be minimized or protected".into());
        }
        Ok(Response::new(bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn native_capture_start(
    id: String,
    consumer: String,
    window: AppWindow,
    capture: State<'_, NativeCapture>,
) -> Result<(), String> {
    let manager = capture.inner().clone();
    let owner = format!("{}:{consumer}", window.label());
    tauri::async_runtime::spawn_blocking(move || {
        let mut sessions = manager.0.lock().map_err(|_| "Capture state unavailable")?;
        if let Some(session) = sessions.get_mut(&id) {
            session.consumers.insert(owner);
            return Ok(());
        }
        let latest = Arc::new(Mutex::new(Latest::default()));
        let control = start(
            &id,
            Flags {
                latest: latest.clone(),
                thumbnail: false,
            },
        )?;
        sessions.insert(
            id,
            Session {
                latest,
                control,
                consumers: HashSet::from([owner]),
            },
        );
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn native_capture_frame(
    id: String,
    consumer: String,
    window: AppWindow,
    capture: State<NativeCapture>,
) -> Result<Response, String> {
    let sessions = capture.0.lock().map_err(|_| "Capture state unavailable")?;
    let session = sessions.get(&id).ok_or("Capture ended")?;
    if !session
        .consumers
        .contains(&format!("{}:{consumer}", window.label()))
    {
        return Err("Capture subscription expired".into());
    }
    let latest = session
        .latest
        .lock()
        .map_err(|_| "Capture state unavailable")?;
    if latest.closed {
        return Err("Captured window was closed".into());
    }
    Ok(Response::new(latest.jpeg.clone()))
}
#[tauri::command]
pub async fn native_capture_stop(
    id: String,
    consumer: String,
    window: AppWindow,
    capture: State<'_, NativeCapture>,
) -> Result<(), String> {
    let manager = capture.inner().clone();
    let owner = format!("{}:{consumer}", window.label());
    tauri::async_runtime::spawn_blocking(move || manager.release(Some(&id), &owner, false))
        .await
        .map_err(|e| e.to_string())?
}
impl NativeCapture {
    pub fn server_frame(&self, window: AppWindow, owner: String) -> Result<Vec<u8>, String> {
        let id = format!(
            "native-window-{}",
            window.hwnd().map_err(|e| e.to_string())?.0 as usize
        );
        let mut sessions = self.0.lock().map_err(|_| "Capture state unavailable")?;
        if !sessions.contains_key(&id) {
            let latest = Arc::new(Mutex::new(Latest::default()));
            let control = start(
                &id,
                Flags {
                    latest: latest.clone(),
                    thumbnail: false,
                },
            )?;
            sessions.insert(
                id.clone(),
                Session {
                    latest,
                    control,
                    consumers: HashSet::new(),
                },
            );
        }
        let session = sessions.get_mut(&id).unwrap();
        session.consumers.insert(owner);
        let frame = session
            .latest
            .lock()
            .map_err(|_| "Capture state unavailable")?;
        if frame.closed {
            return Err("Output window closed".into());
        }
        Ok(frame.jpeg.clone())
    }
    fn release(&self, source: Option<&str>, owner: &str, prefix: bool) -> Result<(), String> {
        let mut stopped = Vec::new();
        {
            let mut sessions = self.0.lock().map_err(|_| "Capture state unavailable")?;
            for (id, session) in sessions.iter_mut() {
                if source.is_some_and(|source| source != id) {
                    continue;
                }
                session.consumers.retain(|consumer| {
                    if prefix {
                        !consumer.starts_with(owner)
                    } else {
                        consumer != owner
                    }
                });
            }
            let ids: Vec<_> = sessions
                .iter()
                .filter(|(_, s)| s.consumers.is_empty())
                .map(|(id, _)| id.clone())
                .collect();
            for id in ids {
                if let Some(session) = sessions.remove(&id) {
                    stopped.push(session.control);
                }
            }
        }
        for control in stopped {
            let _ = control.stop();
        }
        Ok(())
    }
    pub fn close_window(&self, label: &str) {
        let manager = self.clone();
        let owner = format!("{label}:");
        std::thread::spawn(move || {
            let _ = manager.release(None, &owner, true);
        });
    }
}

#[cfg(test)]
mod quality_tests {
    use super::encode_frame;
    #[test]
    fn browser_capture_is_isolated_and_keeps_covered_rendering_enabled() {
        let args = super::capture_browser_args("https://www.youtube.com/watch?v=fixture&x=one", std::path::Path::new("C:/FreeShow capture profile")).unwrap();
        assert!(args.contains(&"--disable-backgrounding-occluded-windows".into()));
        assert!(args.contains(&"--disable-renderer-backgrounding".into()));
        assert!(args[0].starts_with("--user-data-dir="));
        assert_eq!(args.last().unwrap(), "https://www.youtube.com/watch?v=fixture&x=one");
        for url in ["file:///C:/test", "javascript:alert(1)", "--disable-gpu", "https://user:secret@example.com"] {
            assert!(super::capture_browser_args(url, std::path::Path::new("profile")).is_err());
        }
    }
    #[test]
    fn live_capture_preserves_4k_pixels_and_fine_detail() {
        let source = image::RgbaImage::from_fn(3840, 2160, |x, _| {
            let level = if x % 2 == 0 { 0 } else { 255 };
            image::Rgba([level, level, level, 255])
        });
        let decoded = image::load_from_memory(&encode_frame(source, false).unwrap()).unwrap().to_rgb8();
        assert_eq!(decoded.dimensions(), (3840, 2160));
        for x in 100..116 {
            let expected: i16 = if x % 2 == 0 { 0 } else { 255 };
            assert!((decoded.get_pixel(x, 100)[0] as i16 - expected).abs() <= 4,
                "One-pixel source detail must survive capture encoding");
        }
    }
    #[test]
    fn picker_thumbnail_stays_small_and_preserves_aspect_ratio() {
        let source = image::RgbaImage::new(2160, 3840);
        let decoded = image::load_from_memory(&encode_frame(source, true).unwrap()).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (101, 180));
    }
}
