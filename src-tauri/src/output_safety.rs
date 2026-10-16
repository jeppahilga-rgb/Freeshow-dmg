use tauri::{Emitter, Manager};

fn non_rude_policy(label: &str, fullscreen: bool) -> bool {
    label == "main" && !fullscreen
}

#[cfg(windows)]
unsafe fn set_non_rude(hwnd: windows::Win32::Foundation::HWND, normal_editor: bool) -> windows::core::Result<()> {
    use windows::{core::w, Win32::{Foundation::HANDLE, UI::WindowsAndMessaging::{SetPropW, RemovePropW}}};
    if normal_editor {
        SetPropW(hwnd, w!("NonRudeHWND"), Some(HANDLE(1usize as *mut _)))?;
    } else {
        let _ = RemovePropW(hwnd, w!("NonRudeHWND"));
    }
    Ok(())
}

pub fn editor_fullscreen_policy(window: &tauri::Window, fullscreen: bool) {
    #[cfg(windows)] {
    if window.label() != "main" { return; }
    let Ok(handle) = window.hwnd() else { return; };
    let hwnd = windows::Win32::Foundation::HWND(handle.0 as *mut _);
    unsafe {
        if let Err(error) = set_non_rude(hwnd, non_rude_policy(window.label(), fullscreen)) {
            eprintln!("Could not update editor shell policy: {error}");
        }
        if !fullscreen {
            // FALSE alone lets Explorer re-detect a borderless window as fullscreen.
            // NonRudeHWND explicitly excludes the editor from that heuristic.
            use windows::Win32::{System::Com::{CoInitializeEx, CoCreateInstance, CoUninitialize, COINIT_APARTMENTTHREADED, CLSCTX_INPROC_SERVER}, UI::Shell::{ITaskbarList2, TaskbarList}};
            let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
            if let Ok(taskbar) = CoCreateInstance::<_, ITaskbarList2>(&TaskbarList, None, CLSCTX_INPROC_SERVER) {
                if taskbar.HrInit().is_ok() { let _ = taskbar.MarkFullscreenWindow(hwnd, false); }
            }
            if initialized { CoUninitialize(); }
        }
    }
    }
    #[cfg(not(windows))] let _ = (window, fullscreen);
}

pub fn dismiss(window: &tauri::Window) -> Result<(), String> {
    let _ = window.set_fullscreen(false);
    window.set_always_on_top(false).map_err(|e| e.to_string())?;
    window.hide().map_err(|e| e.to_string())?;
    window.close().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn dismiss_output_and_blockers(window: &tauri::Window) -> Result<(), String> {
    let result = dismiss(window);
    // Multiple configured outputs can overlap on the laptop. Returning focus to
    // the editor leaves the other borderless surfaces behind it, so recover the
    // entire blocking group just as Escape in the editor does.
    dismiss_blocking(window.app_handle(), false);
    result
}

pub fn restore_editor(app: &tauri::AppHandle) {
    if let Some(main) = app.get_window("main") {
        let _ = main.set_fullscreen(false);
        editor_fullscreen_policy(&main, false);
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
}

fn covers_center(output: (i32, i32, u32, u32), editor: (i32, i32, u32, u32)) -> bool {
    let (x, y, w, h) = output;
    let cx = editor.0 as i64 + editor.2 as i64 / 2;
    let cy = editor.1 as i64 + editor.3 as i64 / 2;
    w > 0 && h > 0 && cx >= x as i64 && cy >= y as i64
        && cx < x as i64 + w as i64 && cy < y as i64 + h as i64
}

type Bounds = (i32, i32, u32, u32);
fn recovery_labels(windows: &[(String, Option<Bounds>)], editor: Option<Bounds>, all: bool) -> Vec<String> {
    windows.iter().filter(|(label, bounds)| {
        label.starts_with("output-") && (all || editor.zip(*bounds).is_some_and(|(editor, output)| covers_center(output, editor)))
    }).map(|(label, _)| label.clone()).collect()
}

fn bounds(window: &tauri::Window) -> Option<Bounds> {
    let p = window.outer_position().ok()?;
    let s = window.outer_size().ok()?;
    Some((p.x, p.y, s.width, s.height))
}

pub fn dismiss_blocking(app: &tauri::AppHandle, all: bool) {
    let windows = app.windows();
    let editor = windows.get("main").and_then(bounds);
    let rectangles = windows.iter().map(|(label, window)| (label.clone(), bounds(window))).collect::<Vec<_>>();
    for label in recovery_labels(&rectangles, editor, all) {
        if let Some(window) = windows.get(&label) { let _ = dismiss(window); }
    }
    restore_editor(app);
}

#[cfg(windows)]
pub fn install(app: tauri::AppHandle) {
    // Thread-owned Windows hotkey works even when an output/embedded website has
    // focus, or the unfocused output has covered the editor's entire monitor.
    std::thread::spawn(move || {
        use windows::Win32::UI::{Input::KeyboardAndMouse::{RegisterHotKey, UnregisterHotKey, MOD_CONTROL, MOD_SHIFT, MOD_NOREPEAT, VK_F12}, WindowsAndMessaging::{GetMessageW, MSG, WM_HOTKEY}};
        unsafe {
            if let Err(error) = RegisterHotKey(None, 0x4653, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, VK_F12.0 as u32) {
                eprintln!("Output recovery shortcut unavailable: {error}");
                let _ = app.emit_to("main", "freeshow-ipc", serde_json::json!({"channel":"MAIN","msg":{"channel":"ALERT","data":"Ctrl+Shift+F12 is already in use. Press Escape in FreeShow to dismiss an output covering the editor."}}));
                return;
            }
            let mut message = MSG::default();
            while GetMessageW(&mut message, None, 0, 0).0 > 0 {
                if message.message == WM_HOTKEY && message.wParam.0 == 0x4653 {
                    let app = app.clone();
                    let dispatch = app.clone();
                    let _ = dispatch.run_on_main_thread(move || dismiss_blocking(&app, true));
                }
            }
            let _ = UnregisterHotKey(None, 0x4653);
        }
    });
}
#[cfg(not(windows))]
pub fn install(_app: tauri::AppHandle) {
    // Escape/double-click recovery is installed in each webview on macOS.
    // The Windows-wide RegisterHotKey API has no macOS implementation here.
}

#[cfg(test)]
mod tests {
    use super::covers_center;
    #[test]
    fn recovery_closes_all_overlapping_laptop_outputs_but_preserves_other_destinations() {
        let windows = vec![
            ("main".into(), Some((40, -8, 1888, 1096))),
            ("output-center".into(), Some((0, 0, 1920, 1080))),
            ("output-side".into(), Some((0, 0, 1920, 1080))),
            ("output-projector".into(), Some((-1920, 0, 1920, 1080))),
            ("output-virtual-camera".into(), Some((1984, 0, 1280, 720))),
            ("website-source-fixture".into(), Some((0, 0, 1920, 1080))),
        ];
        assert_eq!(super::recovery_labels(&windows, windows[0].1, false), vec!["output-center", "output-side"]);
        assert_eq!(super::recovery_labels(&windows, windows[0].1, true), vec!["output-center", "output-side", "output-projector", "output-virtual-camera"]);
    }
    #[test]
    fn emergency_stop_does_not_need_editor_or_output_geometry() {
        let windows = vec![("main".into(), None), ("output-center".into(), None)];
        assert_eq!(super::recovery_labels(&windows, None, true), vec!["output-center"]);
        assert!(super::recovery_labels(&windows, None, false).is_empty());
    }
    #[test]
    #[cfg(windows)]
    fn shell_property_is_applied_removed_and_restored_on_a_real_hidden_hwnd() {
        use windows::{core::w, Win32::UI::WindowsAndMessaging::{CreateWindowExW, DestroyWindow, GetPropW, HWND_MESSAGE, WINDOW_EX_STYLE, WINDOW_STYLE}};
        unsafe {
            // Message-only test window: no UI, taskbar entry or changes to a user window.
            let hwnd = CreateWindowExW(WINDOW_EX_STYLE::default(), w!("STATIC"), w!("FreeShow shell policy test"), WINDOW_STYLE::default(), 0, 0, 0, 0, Some(HWND_MESSAGE), None, None, None).unwrap();
            struct Cleanup(windows::Win32::Foundation::HWND);
            impl Drop for Cleanup { fn drop(&mut self) { unsafe { let _ = DestroyWindow(self.0); } } }
            let _cleanup = Cleanup(hwnd);
            for normal in [true, false, true] {
                super::set_non_rude(hwnd, normal).unwrap();
                assert_eq!(GetPropW(hwnd, w!("NonRudeHWND")).0 as usize, if normal { 1 } else { 0 });
            }
        }
    }
    #[test]
    fn shell_exception_only_applies_to_normal_editor_not_projector_or_fullscreen() {
        assert!(super::non_rude_policy("main", false));
        assert!(!super::non_rude_policy("main", true));
        assert!(!super::non_rude_policy("output-center", false));
        assert!(!super::non_rude_policy("output-center", true));
    }
    #[test]
    fn editor_monitor_outputs_block_but_projector_and_offscreen_outputs_do_not() {
        let editor = (0, 0, 1920, 1080);
        assert!(covers_center((0, 0, 1920, 1080), editor));
        assert!(!covers_center((1920, 0, 1920, 1080), editor));
        assert!(!covers_center((3904, 0, 1280, 720), editor));
        assert!(covers_center((-1920, 0, 1920, 1080), (-1920, 0, 1600, 900)));
        assert!(!covers_center((0, 0, 0, 1080), editor));
    }
}
