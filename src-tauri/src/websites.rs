pub(crate) async fn set_audio(view: &tauri::Webview, muted: bool) -> Result<(), String> {
    #[cfg(windows)] {
        use windows_core::Interface;
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_8;
        let (send, receive) = tokio::sync::oneshot::channel();
        view.with_webview(move |platform| {
            let result = (|| -> Result<(), String> {
                let core = unsafe { platform.controller().CoreWebView2() }.map_err(|e| e.to_string())?;
                let media: ICoreWebView2_8 = core.cast().map_err(|e| e.to_string())?;
                unsafe {
                    media.SetIsMuted(muted).map_err(|e| e.to_string())?;
                    core.Settings().map_err(|e| e.to_string())?.SetAreDefaultContextMenusEnabled(false).map_err(|e| e.to_string())?;
                }
                Ok(())
            })();
            let _ = send.send(result);
        }).map_err(|e| e.to_string())?;
        receive.await.map_err(|e| e.to_string())??;
    }
    #[cfg(not(windows))] view.eval(&format!("document.querySelectorAll('audio,video').forEach(e=>e.muted={muted})")).map_err(|e|e.to_string())?;
    Ok(())
}
use tauri::{LogicalPosition, LogicalSize, Manager, Webview, WebviewUrl};
use std::{collections::HashMap, sync::Mutex};
#[derive(Default)]
pub struct WebsiteFollowers(Mutex<FollowRegistry>);
#[derive(Default)]
struct FollowRegistry { groups: HashMap<String,String>, owners: HashMap<String,String> }

#[tauri::command]
pub fn website_follow(app: tauri::AppHandle, caller: Webview, data: serde_json::Value, state: tauri::State<WebsiteFollowers>) -> Result<(),String> {
    if data.to_string().len()>32768 { return Err("Website state too large".into()); }
    if caller.window().label() != "main" || !caller.label().starts_with("main-website-") { return Err("Website preview only".into()); }
    let url = data["url"].as_str().filter(|s|s.len()<=8192).ok_or("Invalid URL")?;
    let parsed = tauri::Url::parse(url).map_err(|e|e.to_string())?;
    if !matches!(parsed.scheme(),"http"|"https") { return Err("Only web navigation".into()); }
    for key in ["click","expanded"] { if !data[key].is_null() && !data[key].as_str().is_some_and(|s|s.len()<=2048) { return Err("Invalid element".into()); } }
    for key in ["scrollX","scrollY"] { if !data[key].as_f64().is_some_and(|n|n.is_finite() && n.abs()<10_000_000.0) { return Err("Invalid scroll position".into()); } }
    if !data["media"].is_null() {
        if !data["media"]["time"].as_f64().is_some_and(|n|n.is_finite()&&n>=0.0&&n<604800.0)
            || !data["media"]["rate"].as_f64().is_some_and(|n|n.is_finite()&&n>=0.1&&n<=16.0)
            || !data["media"]["paused"].is_boolean() { return Err("Invalid playback state".into()); }
    }
    let targets = {
        let mut registry=state.0.lock().unwrap();
        let group=registry.groups.get(caller.label()).cloned().ok_or("Unregistered website")?;
        if data["interaction"]==true || !registry.owners.contains_key(&group) { registry.owners.insert(group.clone(),caller.label().into()); }
        if registry.owners.get(&group).map(String::as_str)!=Some(caller.label()) { return Ok(()); }
        registry.groups.iter().filter(|(id,g)|**g==group && id.as_str()!=caller.label()).map(|(id,_)|id.clone()).collect::<Vec<_>>()
    };
    // Only structured state is accepted from website pages; they cannot execute arbitrary FreeShow commands.
    let script=format!("window.__freeshowFollow?.({})",serde_json::to_string(&data).map_err(|e|e.to_string())?);
    for id in targets { if let Some(view)=app.get_webview(&id) { let _=view.eval(&script); } }
    Ok(())
}

pub(crate) async fn navigation(view: &Webview, action: &str) -> Result<serde_json::Value, String> {
    #[cfg(windows)] {
        let (send, receive) = tokio::sync::oneshot::channel();
        let action = action.to_owned();
        view.with_webview(move |platform| {
            let result = (|| -> Result<serde_json::Value, String> {
                let core = unsafe { platform.controller().CoreWebView2() }.map_err(|e| e.to_string())?;
                unsafe {
                    if action == "back" { core.GoBack().map_err(|e| e.to_string())?; }
                    if action == "forward" { core.GoForward().map_err(|e| e.to_string())?; }
                    let mut back = Default::default();
                    let mut forward = Default::default();
                    core.CanGoBack(&mut back).map_err(|e| e.to_string())?;
                    core.CanGoForward(&mut forward).map_err(|e| e.to_string())?;
                    Ok(serde_json::json!({"canGoBack":back.as_bool(),"canGoForward":forward.as_bool()}))
                }
            })();
            let _ = send.send(result);
        }).map_err(|e| e.to_string())?;
        let mut result = receive.await.map_err(|e| e.to_string())??;
        result["url"] = serde_json::json!(view.url().map_err(|e| e.to_string())?.as_str());
        Ok(result)
    }
    #[cfg(not(windows))] {
        if action == "back" { view.eval("history.back()").map_err(|e| e.to_string())?; }
        if action == "forward" { view.eval("history.forward()").map_err(|e| e.to_string())?; }
        Ok(serde_json::json!({"url":view.url().map_err(|e| e.to_string())?.as_str()}))
    }
}

#[tauri::command]
pub async fn website_view(
    app: tauri::AppHandle,
    caller: Webview,
    id: String,
    action: String,
    url: Option<String>,
    bounds: Option<serde_json::Value>,
    zoom: Option<f64>,
    key: Option<String>,
    muted: Option<bool>,
) -> Result<serde_json::Value, String> {
    let parent = caller.window();
    if caller.label() != parent.label()
        || !(parent.label() == "main" || parent.label().starts_with("output-"))
    {
        return Err("Editor or output only".into());
    }
    if !id.starts_with(&format!("{}-website-", parent.label()))
        || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("Invalid website ID".into());
    }
    if action == "close" {
        let registry=app.state::<WebsiteFollowers>();
        let mut registry=registry.0.lock().unwrap();
        registry.groups.remove(&id);
        registry.owners.retain(|_,owner|owner!=&id);
        drop(registry);
        if let Some(view) = app.get_webview(&id) {
            view.close().map_err(|e| e.to_string())?;
        }
        return Ok(serde_json::Value::Null);
    }
    if action == "hide" {
        if let Some(view) = app.get_webview(&id) {
            set_audio(&view, true).await?;
            view.hide().map_err(|e| e.to_string())?;
        }
        return Ok(serde_json::Value::Null);
    }
    if action == "reload" {
        if let Some(view) = app.get_webview(&id) {
            view.reload().map_err(|e| e.to_string())?;
        }
        return Ok(serde_json::Value::Null);
    }
    if action=="mute" {
        let state=muted.ok_or("Missing mute state")?;
        if let Some(view)=app.get_webview(&id){set_audio(&view,parent.label()=="main"||state).await?;}
        return Ok(serde_json::Value::Null)
    }
    if matches!(action.as_str(), "status" | "back" | "forward" | "key") {
        let Some(view) = app.get_webview(&id) else { return Ok(serde_json::Value::Null); };
        if action == "key" {
            let key = key.ok_or("Missing website key")?;
            let key = match key.as_str() { "Left" => "ArrowLeft", "Right" => "ArrowRight", "Up" => "ArrowUp", "Down" => "ArrowDown", "Space" => " ", _ => &key };
            let encoded = serde_json::to_string(key).map_err(|e| e.to_string())?;
            view.eval(&format!("(()=>{{const key={encoded};const target=document.activeElement||document.body;for(const type of ['keydown','keyup'])target.dispatchEvent(new KeyboardEvent(type,{{key,code:key===' '?'Space':key,bubbles:true,cancelable:true}}));}})()" )).map_err(|e| e.to_string())?;
        }
        return navigation(&view, &action).await;
    }
    if action != "show" { return Err("Unknown website action".into()); }
    let bounds = bounds.ok_or("Missing website bounds")?;
    let number = |key: &str| {
        bounds
            .get(key)
            .and_then(|v| v.as_f64())
            .filter(|v| v.is_finite())
            .ok_or("Invalid bounds")
    };
    let scale = parent.scale_factor().map_err(|e| e.to_string())?;
    let viewport = parent.inner_size().map_err(|e| e.to_string())?;
    let x = number("x")?.max(0.0).min(viewport.width as f64 / scale);
    let y = number("y")?.max(0.0).min(viewport.height as f64 / scale);
    let position = LogicalPosition::new(x, y);
    let size = LogicalSize::new(
        number("width")?
            .max(1.0)
            .min((viewport.width as f64 / scale - x).max(1.0)),
        number("height")?
            .max(1.0)
            .min((viewport.height as f64 / scale - y).max(1.0)),
    );
    let url = url
        .map(|url| url.parse::<tauri::Url>().map_err(|e| e.to_string()))
        .transpose()?;
    if let Some(url)=&url { app.state::<WebsiteFollowers>().0.lock().unwrap().groups.insert(id.clone(),url.as_str().into()); }
    if let Some(url) = &url {
        if !matches!(url.scheme(), "http" | "https") {
            return Err("Only web URLs are supported".into());
        }
    }
    let view = if let Some(view) = app.get_webview(&id) {
        if let Some(url) = url {
            view.navigate(url).map_err(|e| e.to_string())?;
        }
        view.set_position(position).map_err(|e| e.to_string())?;
        view.set_size(size).map_err(|e| e.to_string())?;
        view
    } else {
        parent
            .add_child(
                tauri::webview::WebviewBuilder::new(
                    id,
                    WebviewUrl::External(url.ok_or("Missing URL")?),
                ).initialization_script(include_str!("website_follow.js"))
                .initialization_script("document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(document.fullscreenElement)document.exitFullscreen();else window.__TAURI_INTERNALS__?.invoke('exit_fullscreen')}},true)"),
                position,
                size,
            )
            .map_err(|e| e.to_string())?
    };
    view.set_zoom(zoom.unwrap_or(1.0).clamp(0.01, 5.0))
        .map_err(|e| e.to_string())?;
    set_audio(&view, parent.label() == "main" || muted.unwrap_or(true)).await?;
    view.show().map_err(|e| e.to_string())?;
    navigation(&view, "status").await
}
