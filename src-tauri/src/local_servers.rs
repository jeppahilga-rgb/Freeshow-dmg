use axum::{
    body::Bytes,
    extract::State as HttpState,
    http::{HeaderMap, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::any,
    Router,
};
use base64::Engine;
use include_dir::{include_dir, Dir};
use serde_json::{json, Value};
use socketioxide::{
    extract::{Data, SocketRef},
    SocketIo,
};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, State, Webview};
static ASSETS: Dir = include_dir!("$CARGO_MANIFEST_DIR/../dist-local");
type Pending = Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<Value>>>>;
#[derive(Clone)]
struct Context {
    app: tauri::AppHandle,
    kind: String,
    token: String,
    password: Arc<Mutex<String>>,
    pending: Pending,
    data: Arc<Mutex<Value>>,
}
struct Service {
    port: u16,
    context: Context,
    io: SocketIo,
    approved: Arc<Mutex<HashSet<String>>>,
    limit: Arc<AtomicUsize>,
    tasks: Vec<tokio::task::JoinHandle<()>>,
}
#[derive(Default)]
pub struct LocalServers {
    services: tokio::sync::Mutex<HashMap<String, Service>>,
    data: Arc<Mutex<Value>>,
    pending: Pending,
}
async fn frame(app: &tauri::AppHandle, kind: &str, output: &str) -> Option<Value> {
    let window = app.get_window(&format!("output-{output}"))?;
    let capture = app
        .state::<crate::native_capture::NativeCapture>()
        .inner()
        .clone();
    let owner = format!("server-{kind}-:{output}");
    let bytes = tauri::async_runtime::spawn_blocking(move || capture.server_frame(window, owner))
        .await
        .ok()?
        .ok()?;
    if bytes.is_empty() {
        return None;
    }
    let (width, height) = image::ImageReader::new(std::io::Cursor::new(&bytes))
        .with_guessed_format()
        .ok()?
        .into_dimensions()
        .ok()?;
    Some(
        json!({"id":output,"jpeg":format!("data:image/jpeg;base64,{}",base64::engine::general_purpose::STANDARD.encode(&bytes)),"size":{"width":width,"height":height}}),
    )
}
fn trusted(caller: &Webview) -> Result<(), String> {
    if caller.label() != "main" {
        Err("Main window only".into())
    } else {
        Ok(())
    }
}
fn emit(context: &Context, msg: Value) {
    let _ = context.app.emit_to(
        "main",
        "freeshow-ipc",
        json!({"channel":context.kind.to_uppercase(),"msg":msg}),
    );
}
fn token(query: &str) -> HashMap<String, String> {
    tauri::Url::parse(&format!("http://local/?{query}"))
        .map(|u| {
            u.query_pairs()
                .map(|(k, v)| (k.into_owned(), v.into_owned()))
                .collect()
        })
        .unwrap_or_default()
}
fn allowed(
    context: &Context,
    values: &Value,
    headers: &HeaderMap,
    query: &HashMap<String, String>,
) -> bool {
    let password = context.password.lock().unwrap().clone();
    if password.is_empty() {
        return true;
    }
    [
        "auth",
        "password",
        "token",
        "key",
        "apiKey",
        "authKey",
        "authorization",
        "x-api-key",
    ]
    .iter()
    .any(|key| {
        let value = values
            .get(key)
            .and_then(Value::as_str)
            .or_else(|| query.get(*key).map(String::as_str))
            .or_else(|| headers.get(*key).and_then(|v| v.to_str().ok()));
        value.is_some_and(|v| v.trim().strip_prefix("Bearer ").unwrap_or(v.trim()) == password)
    })
}
async fn action(context: &Context, mut msg: Value) -> Result<Option<Value>, String> {
    let variables = msg["isVariable"] == true;
    if !msg.is_object() || (!variables && msg["action"].as_str().is_none()) {
        return Err("An action is required".into());
    }
    let expects_response = variables
        || msg["action"]
            .as_str()
            .unwrap_or("")
            .trim_start_matches('/')
            .starts_with("get_");
    let id = uuid::Uuid::new_v4().to_string();
    let receiver = if expects_response {
        let (tx, rx) = tokio::sync::oneshot::channel();
        context.pending.lock().unwrap().insert(id.clone(), tx);
        msg["returnId"] = json!(id);
        Some(rx)
    } else {
        None
    };
    let payload = if variables {
        json!({"channel":"MAIN","id":id,"msg":{"channel":"GET_DYNAMIC_VALUES","data":msg["keys"].as_array().cloned().unwrap_or_default()}})
    } else {
        json!({"channel":"MAIN","msg":{"channel":"API_TRIGGER2","data":msg}})
    };
    context
        .app
        .emit_to("main", "freeshow-ipc", payload)
        .map_err(|e| e.to_string())?;
    if let Some(receiver) = receiver {
        let result = tokio::time::timeout(Duration::from_secs(10), receiver).await;
        context.pending.lock().unwrap().remove(&id);
        return result
            .map_err(|_| "API request timed out".to_string())?
            .map(Some)
            .map_err(|_| "API response cancelled".into());
    }
    Ok(None)
}
async fn http(
    HttpState(context): HttpState<Context>,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let query = token(uri.query().unwrap_or(""));
    if context.kind == "companion" {
        let mut msg = if body.is_empty() {
            json!({})
        } else {
            match serde_json::from_slice::<Value>(&body) {
                Ok(v) => v,
                Err(_) => return (StatusCode::BAD_REQUEST, "Invalid JSON").into_response(),
            }
        };
        if !msg.is_object() {
            return (StatusCode::BAD_REQUEST, "Expected object").into_response();
        }
        for (key, value) in &query {
            if key == "data" {
                if let Ok(Value::Object(data)) = serde_json::from_str::<Value>(value) {
                    for (k, v) in data {
                        msg[k] = v;
                    }
                }
            } else {
                msg[key] = json!(value);
            }
        }
        if !allowed(&context, &msg, &headers, &query) {
            return (StatusCode::UNAUTHORIZED, "Invalid API password").into_response();
        }
        if msg.get("action").is_none() {
            return StatusCode::NO_CONTENT.into_response();
        }
        return match action(&context, msg).await {
            Ok(Some(value)) => axum::Json(value).into_response(),
            Ok(None) => StatusCode::NO_CONTENT.into_response(),
            Err(e) => (StatusCode::BAD_REQUEST, e).into_response(),
        };
    }
    // The mobile Remote app opens the bare address. Its login page is public;
    // Remote messages and private updates are password-gated below. Other views
    // continue to require their QR pairing token.
    let path = uri.path().trim_start_matches('/');
    if path.is_empty() && context.kind != "remote" && query.get("token") != Some(&context.token) {
        return (StatusCode::FORBIDDEN, "Open the QR link from FreeShow").into_response();
    }
    let path = if path.is_empty() { "index.html" } else { path };
    let Some(file) = ASSETS.get_file(format!("{}/{path}", context.kind)) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mime = if path.ends_with(".js") {
        "application/javascript"
    } else if path.ends_with(".css") {
        "text/css"
    } else if path.ends_with(".png") {
        "image/png"
    } else if path.ends_with(".json") {
        "application/json"
    } else {
        "text/html"
    };
    (
        [("content-type", mime), ("cache-control", "no-store")],
        file.contents().to_vec(),
    )
        .into_response()
}
#[tauri::command]
pub async fn local_server_start(
    app: tauri::AppHandle,
    caller: Webview,
    state: State<'_, LocalServers>,
    kind: String,
    port: u16,
    password: Option<String>,
    max: Option<usize>,
) -> Result<Value, String> {
    trusted(&caller)?;
    if ![
        "remote",
        "stage",
        "controller",
        "output_stream",
        "companion",
    ]
    .contains(&kind.as_str())
        || port == 0
        || (kind == "companion" && port == 65535)
    {
        return Err("Invalid local service or port".into());
    }
    let mut services = state.services.lock().await;
    if let Some(service) = services.get(&kind) {
        if service.port == port {
            if let Some(password) = password {
                *service.context.password.lock().unwrap() = password;
            }
            if let Some(max) = max {
                service.limit.store(max.clamp(1, 100), Ordering::Relaxed);
            }
            return urls(service);
        }
    }
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .map_err(|e| format!("{kind} port {port}: {e}"))?;
    let rest = if kind == "companion" {
        Some(
            tokio::net::TcpListener::bind(("0.0.0.0", port + 1))
                .await
                .map_err(|e| format!("REST port {}: {e}", port + 1))?,
        )
    } else {
        None
    };
    let udp = if kind == "companion" {
        Some(
            tokio::net::UdpSocket::bind(("0.0.0.0", port))
                .await
                .map_err(|e| format!("OSC port {port}: {e}"))?,
        )
    } else {
        None
    };
    if let Some(old) = services.remove(&kind) {
        stop_service(old).await;
    }
    let context = Context {
        app: app.clone(),
        kind: kind.clone(),
        token: uuid::Uuid::new_v4().to_string(),
        password: Arc::new(Mutex::new(password.unwrap_or_default())),
        pending: state.pending.clone(),
        data: state.data.clone(),
    };
    let (layer, io) = SocketIo::builder()
        .max_payload(65536)
        .max_buffer_size(16)
        .build_layer();
    let approved = Arc::new(Mutex::new(HashSet::<String>::new()));
    let subscriptions = Arc::new(Mutex::new(HashMap::<String, (String, Instant)>::new()));
    let approved_connect = approved.clone();
    let subscriptions_connect = subscriptions.clone();
    let connect = context.clone();
    let limit = Arc::new(AtomicUsize::new(max.unwrap_or(10).clamp(1, 100)));
    let connect_limit = limit.clone();
    let connected_io = io.clone();
    io.ns("/",move |socket: SocketRef, Data(auth): Data<Value>| {
        let context=connect.clone();let io=connected_io.clone();let approved=approved_connect.clone();let subscriptions=subscriptions_connect.clone();let limit=connect_limit.clone();
        async move {
            let query=token(socket.req_parts().uri.query().unwrap_or(""));
            let permitted=context.kind=="companion" || context.kind=="remote" || query.get("token")==Some(&context.token);
            if !permitted || io.sockets().len()>limit.load(Ordering::Relaxed){let _=socket.emit("error",&json!({"error":"Connection denied"}));let _=socket.disconnect();return;}
            if context.kind=="companion" {
                let api=context.clone();let handshake_auth=auth;
                socket.on("data",move |socket:SocketRef,Data(msg):Data<Value>|{let context=api.clone();let auth=handshake_auth.clone();async move{
                    let msg=if let Some(text)=msg.as_str(){serde_json::from_str(text).unwrap_or(Value::Null)}else{msg};
                    let query=token(socket.req_parts().uri.query().unwrap_or(""));
                    if !allowed(&context,&msg,&socket.req_parts().headers,&query) && !allowed(&context,&auth,&socket.req_parts().headers,&query){let _=socket.emit("data",&json!({"error":"Unauthorized"}));return;}
                    match action(&context,msg).await{Ok(Some(value))=>{let _=socket.emit("data",&value);},Err(e)=>{let _=socket.emit("data",&json!({"error":e}));},_=>{}}
                }});
            }else{
                emit(&context,json!({"channel":"CONNECTION","id":socket.id.to_string(),"data":{"name":"Local browser"}}));
                let receive=context.clone();let event=context.kind.to_uppercase();
                let approved_messages=approved.clone();let subscribed=subscriptions.clone();
                socket.on(event,move |socket:SocketRef,Data(mut msg):Data<Value>|{let context=receive.clone();let approved=approved_messages.clone();let subscriptions=subscribed.clone();async move{
                    if !msg.is_object() || msg["channel"].as_str().is_none(){return;}
                    if context.kind=="remote" {
                        let password=context.data.lock().unwrap()["remote"]["password"].as_str().unwrap_or("").to_string();
                        let channel=msg["channel"].as_str().unwrap();
                        let id=socket.id.to_string();
                        if remote_login(channel, &msg["data"], &password) { approved.lock().unwrap().insert(id.clone()); }
                        if !matches!(channel,"PASSWORD"|"ACCESS") && !approved.lock().unwrap().contains(&id) {
                            let _=socket.emit("REMOTE",&json!({"channel":"ERROR","data":"wrongPass"}));return;
                        }
                    }
                    if context.kind=="stage" && msg["channel"]=="STREAM_SUBSCRIBE" {
                        if approved.lock().unwrap().contains(&socket.id.to_string()){if let Some(output)=msg["data"]["outputId"].as_str(){subscriptions.lock().unwrap().insert(socket.id.to_string(),(output.to_string(),Instant::now()));}}return;
                    }
                    if context.kind=="stage" && msg["channel"]=="STREAM_UNSUBSCRIBE"{subscriptions.lock().unwrap().remove(&socket.id.to_string());return;}
                    if context.kind=="controller" && msg["channel"]=="OUTPUT_FRAME"{
                        let output=msg["data"]["outputId"].as_str().unwrap_or("");
                        let result=frame(&context.app,"controller",output).await;
                        let value=result.map(|v|json!({"frame":v["jpeg"],"width":v["size"]["width"],"height":v["size"]["height"]})).unwrap_or(json!({"frame":""}));
                        let _=socket.emit("CONTROLLER",&json!({"channel":"OUTPUT_FRAME","data":value}));return;
                    }
                    msg["id"]=json!(socket.id.to_string());emit(&context,msg);
                }});
            }
            socket.on_disconnect(move |socket:SocketRef|{let context=context.clone();let approved=approved.clone();let subscriptions=subscriptions.clone();async move{approved.lock().unwrap().remove(&socket.id.to_string());subscriptions.lock().unwrap().remove(&socket.id.to_string());emit(&context,json!({"channel":"DISCONNECT","id":socket.id.to_string()}));}});
        }
    });
    let router = Router::new()
        .fallback(any(http))
        .with_state(context.clone())
        .layer(axum::extract::DefaultBodyLimit::max(65536))
        .layer(layer);
    let mut tasks = vec![tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    })];
    if let Some(listener) = rest {
        let router = Router::new()
            .fallback(any(http))
            .with_state(context.clone())
            .layer(axum::extract::DefaultBodyLimit::max(65536));
        tasks.push(tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        }));
    }
    if let Some(udp) = udp {
        let osc = context.clone();
        tasks.push(tokio::spawn(async move {
            let mut buffer = vec![0; 65536];
            while let Ok((size, peer)) = udp.recv_from(&mut buffer).await {
                let Ok((_, packet)) = rosc::decoder::decode_udp(&buffer[..size]) else {
                    continue;
                };
                let mut packets = vec![packet];
                while let Some(packet) = packets.pop() {
                    let message = match packet {
                        rosc::OscPacket::Bundle(bundle) => {
                            packets.extend(bundle.content);
                            continue;
                        }
                        rosc::OscPacket::Message(message) => message,
                    };
                    if !message.addr.starts_with("/freeshow/") {
                        continue;
                    }
                    let mut msg = message
                        .args
                        .first()
                        .and_then(|arg| {
                            if let rosc::OscType::String(text) = arg {
                                serde_json::from_str::<Value>(text).ok()
                            } else {
                                None
                            }
                        })
                        .filter(Value::is_object)
                        .unwrap_or(json!({}));
                    let mut query = HashMap::new();
                    let password = osc.password.lock().unwrap().clone();
                    for arg in &message.args {
                        if let rosc::OscType::String(text) = arg {
                            if text == &password {
                                query.insert("password".into(), text.clone());
                            }
                        }
                    }
                    let result = if !allowed(&osc, &msg, &HeaderMap::new(), &query) {
                        Some(json!({"status":401,"error":"Unauthorized"}))
                    } else {
                        msg["action"] = json!(message.addr.trim_start_matches("/freeshow"));
                        match action(&osc, msg).await {
                            Ok(value) => value,
                            Err(error) => Some(json!({"error":error})),
                        }
                    };
                    if let Some(value) = result {
                        if let Ok(bytes) =
                            rosc::encoder::encode(&rosc::OscPacket::Message(rosc::OscMessage {
                                addr: message.addr,
                                args: vec![rosc::OscType::String(value.to_string())],
                            }))
                        {
                            let _ = udp.send_to(&bytes, peer).await;
                        }
                    }
                }
            }
        }));
    }
    if ["stage", "output_stream", "controller"].contains(&kind.as_str()) {
        let stream_context = context.clone();
        let stream_io = io.clone();
        let data = state.data.clone();
        tasks.push(tokio::spawn(async move {
            let mut timer = tokio::time::interval(Duration::from_millis(200));
            let mut was_active = false;
            let mut previous_outputs = HashSet::new();
            loop {
                timer.tick().await;
                let sockets = stream_io.sockets();
                let targets: HashMap<String, String> = if stream_context.kind == "stage" {
                    let mut subs = subscriptions.lock().unwrap();
                    subs.retain(|_, (_, when)| when.elapsed() < Duration::from_secs(10));
                    subs.iter()
                        .map(|(id, (output, _))| (id.clone(), output.clone()))
                        .collect()
                } else if stream_context.kind == "output_stream" {
                    let configured = data.lock().unwrap()["output_stream"]["outputId"]
                        .as_str()
                        .map(String::from);
                    let output = configured.or_else(|| {
                        stream_context
                            .app
                            .windows()
                            .keys()
                            .find_map(|key| key.strip_prefix("output-").map(String::from))
                    });
                    sockets
                        .iter()
                        .filter_map(|socket| {
                            output
                                .as_ref()
                                .map(|output| (socket.id.to_string(), output.clone()))
                        })
                        .collect()
                } else {
                    HashMap::new()
                };
                let active = if stream_context.kind == "controller" {
                    !sockets.is_empty()
                } else {
                    !targets.is_empty()
                };
                let selected_outputs: HashSet<String> = targets.values().cloned().collect();
                if previous_outputs != selected_outputs && !previous_outputs.is_empty() {
                    stream_context
                        .app
                        .state::<crate::native_capture::NativeCapture>()
                        .close_window(&format!("server-{}-", stream_context.kind));
                }
                previous_outputs = selected_outputs;
                if !active && was_active {
                    stream_context
                        .app
                        .state::<crate::native_capture::NativeCapture>()
                        .close_window(&format!("server-{}-", stream_context.kind));
                }
                was_active = active;
                let mut frames = HashMap::new();
                for output in targets.values() {
                    if !frames.contains_key(output) {
                        if let Some(value) =
                            frame(&stream_context.app, &stream_context.kind, output).await
                        {
                            frames.insert(output.clone(), value);
                        }
                    }
                }
                for socket in sockets {
                    if let Some(value) = targets
                        .get(&socket.id.to_string())
                        .and_then(|id| frames.get(id))
                    {
                        let event = stream_context.kind.to_uppercase();
                        let channel = if stream_context.kind == "stage" {
                            "STREAM_FRAME"
                        } else {
                            "STREAM"
                        };
                        let _ = socket.emit(event, &json!({"channel":channel,"data":value}));
                    }
                }
            }
        }));
    }
    let service = Service {
        port,
        context,
        io,
        approved,
        limit,
        tasks,
    };
    let result = urls(&service)?;
    services.insert(kind, service);
    Ok(result)
}
fn urls(service: &Service) -> Result<Value, String> {
    let mut ips = crate::remote::network_ips();
    ips.push("127.0.0.1".into());
    Ok(
        json!({"urls":ips.iter().map(|ip|format!("http://{ip}:{}/?token={}",service.port,service.context.token)).collect::<Vec<_>>(),"port":service.port}),
    )
}
async fn stop_service(service: Service) {
    for socket in service.io.sockets() {
        emit(
            &service.context,
            json!({"channel":"DISCONNECT","id":socket.id.to_string()}),
        );
    }
    service.io.close().await;
    for task in service.tasks {
        task.abort();
    }
    service
        .context
        .app
        .state::<crate::native_capture::NativeCapture>()
        .close_window(&format!("server-{}-", service.context.kind));
}
#[tauri::command]
pub async fn local_server_stop(
    caller: Webview,
    state: State<'_, LocalServers>,
    kind: String,
) -> Result<(), String> {
    trusted(&caller)?;
    if let Some(service) = state.services.lock().await.remove(&kind) {
        stop_service(service).await;
    }
    Ok(())
}
#[tauri::command]
pub async fn local_server_send(
    caller: Webview,
    state: State<'_, LocalServers>,
    kind: String,
    msg: Value,
) -> Result<(), String> {
    trusted(&caller)?;
    let services = state.services.lock().await;
    let Some(service) = services.get(&kind) else {
        return Ok(());
    };
    let event = kind.to_uppercase();
    if let Some(id) = msg["id"].as_str() {
        if kind == "stage" && msg["channel"] == "LAYOUT" {
            service.approved.lock().unwrap().insert(id.to_string());
        }
        if let Some(socket) = service
            .io
            .sockets()
            .into_iter()
            .find(|socket| socket.id.to_string() == id)
        {
            if remote_response_allowed(&kind, &msg, service.approved.lock().unwrap().contains(id)) {
                let _ = socket.emit(event, &msg);
            }
        }
    } else {
        if kind == "remote" {
            for socket in service.io.sockets() {
                let approved = service.approved.lock().unwrap().contains(&socket.id.to_string());
                if remote_response_allowed(&kind, &msg, approved) { let _ = socket.emit(&event, &msg); }
            }
        } else { let _ = service.io.emit(event, &msg).await; }
    }
    Ok(())
}
#[tauri::command]
pub fn local_api_return(
    caller: Webview,
    state: State<LocalServers>,
    msg: Value,
) -> Result<(), String> {
    trusted(&caller)?;
    if let Some(id) = msg["returnId"].as_str() {
        if let Some(tx) = state.pending.lock().unwrap().remove(id) {
            let _ = tx.send(msg);
        }
    }
    Ok(())
}
#[tauri::command]
pub async fn local_server_data(
    caller: Webview,
    state: State<'_, LocalServers>,
    data: Value,
) -> Result<(), String> {
    trusted(&caller)?;
    let services = state.services.lock().await;
    let changed = state.data.lock().unwrap()["remote"]["password"] != data["remote"]["password"];
    if changed {
        if let Some(service) = services.get("remote") { service.approved.lock().unwrap().clear(); }
    }
    *state.data.lock().unwrap() = data;
    Ok(())
}

fn remote_login(channel: &str, data: &Value, password: &str) -> bool {
    (channel == "PASSWORD" && password.is_empty())
        || (channel == "ACCESS" && (password.is_empty() || data.as_str() == Some(password)))
}
fn remote_response_allowed(kind: &str, msg: &Value, approved: bool) -> bool {
    kind != "remote" || approved || matches!(msg["channel"].as_str(), Some("PASSWORD" | "ACCESS" | "ERROR" | "LANGUAGE" | "THEME_COLORS"))
}

#[cfg(test)]
mod mobile_remote_tests {
    use super::*;
    #[test]
    fn password_required_before_remote_controls() {
        assert!(!remote_login("PASSWORD", &Value::Null, "secret"));
        assert!(!remote_login("ACCESS", &json!("wrong"), "secret"));
        assert!(remote_login("ACCESS", &json!("secret"), "secret"));
        assert!(!remote_login("OUT", &json!("secret"), "secret"));
        assert!(remote_login("PASSWORD", &Value::Null, ""));
    }
    #[test]
    fn private_remote_updates_require_login() {
        for channel in ["SHOWS", "SHOW", "PROJECTS", "OUT", "MEDIA"] {
            assert!(!remote_response_allowed("remote", &json!({"channel":channel}), false));
            assert!(remote_response_allowed("remote", &json!({"channel":channel}), true));
        }
        assert!(remote_response_allowed("remote", &json!({"channel":"PASSWORD"}), false));
    }
}
