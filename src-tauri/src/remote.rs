use bytes::Bytes;
use http_body_util::{BodyExt, Full, Limited};
use hyper::{body::Incoming, server::conn::http1, service::service_fn, Request, Response};
use hyper_util::rt::TokioIo;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    convert::Infallible,
    sync::{Arc, Mutex},
    time::Instant,
};
use tauri::{Emitter, State, Webview};
struct Client {
    queue: VecDeque<Value>,
    seen: Instant,
}
struct Server {
    token: String,
    port: u16,
    clients: Arc<Mutex<HashMap<String, Client>>>,
    task: tokio::task::JoinHandle<()>,
}
#[derive(Default)]
pub struct Remote(tokio::sync::Mutex<Option<Server>>);
#[tauri::command]
pub fn open_url(caller: Webview, url: String) -> Result<(), String> {
    trusted(&caller)?;
    let parsed = tauri::Url::parse(&url).map_err(|e| e.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") && url != "spotify:" {
        return Err("Only web URLs are supported".into());
    }
    std::process::Command::new("rundll32.exe")
        .arg("url.dll,FileProtocolHandler")
        .arg(parsed.as_str())
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
fn trusted(caller: &Webview) -> Result<(), String> {
    if caller.label() == "main" && caller.window().label() == "main" {
        Ok(())
    } else {
        Err("Editor only".into())
    }
}
#[tauri::command]
pub fn network_ips() -> Vec<String> {
    let mut ips = Vec::new();
    if let Ok(std::net::IpAddr::V4(ip)) = local_ip_address::local_ip() {
        if !ip.is_loopback() && !ip.is_link_local() {
            ips.push(ip.to_string())
        }
    }
    if let Ok(interfaces) = local_ip_address::list_afinet_netifas() {
        for (_, ip) in interfaces {
            if let std::net::IpAddr::V4(ip) = ip {
                if !ip.is_loopback()
                    && !ip.is_link_local()
                    && !ip.is_unspecified()
                    && !ips.contains(&ip.to_string())
                {
                    ips.push(ip.to_string())
                }
            }
        }
    }
    ips
}
fn info(server: &Server) -> Value {
    let mut ips = network_ips();
    ips.push("127.0.0.1".into());
    json!({"port":server.port,"urls":ips.iter().map(|ip|format!("http://{ip}:{}/?token={}",server.port,server.token)).collect::<Vec<_>>()})
}
fn response(status: u16, body: impl Into<Bytes>, kind: &str) -> Response<Full<Bytes>> {
    Response::builder()
        .status(status)
        .header("Content-Type", kind)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .body(Full::new(body.into()))
        .unwrap()
}
#[tauri::command]
pub async fn remote_start(
    app: tauri::AppHandle,
    caller: Webview,
    state: State<'_, Remote>,
    port: u16,
) -> Result<Value, String> {
    trusted(&caller)?;
    if port == 0 {
        return Err("Choose a port between 1 and 65535".into());
    }
    let mut guard = state.0.lock().await;
    if let Some(server) = guard.as_ref() {
        if server.port == port {
            return Ok(info(server));
        }
    }
    // Bind before stopping the old server; a failed port change preserves existing clients.
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .map_err(|e| format!("Cannot start remote on port {port}: {e}"))?;
    if let Some(server) = guard.take() {
        server.task.abort();
        for id in server.clients.lock().unwrap().keys() {
            let _ = app.emit_to(
                "main",
                "freeshow-ipc",
                json!({"channel":"REMOTE","msg":{"channel":"DISCONNECT","id":id}}),
            );
        }
    }
    let token = uuid::Uuid::new_v4().to_string();
    let clients = Arc::new(Mutex::new(HashMap::<String, Client>::new()));
    let service_clients = clients.clone();
    let service_token = token.clone();
    let task = tokio::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                break;
            };
            let app = app.clone();
            let clients = service_clients.clone();
            let token = service_token.clone();
            tokio::spawn(async move {
                let service = service_fn(move |request| {
                    handle(request, app.clone(), clients.clone(), token.clone())
                });
                let _ = http1::Builder::new()
                    .serve_connection(TokioIo::new(stream), service)
                    .await;
            });
        }
    });
    let server = Server {
        token,
        port,
        clients,
        task,
    };
    let result = info(&server);
    *guard = Some(server);
    Ok(result)
}
async fn handle(
    request: Request<Incoming>,
    app: tauri::AppHandle,
    clients: Arc<Mutex<HashMap<String, Client>>>,
    token: String,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let path = request.uri().path().to_string();
    let query = request.uri().query().unwrap_or("");
    let params: HashMap<String, String> = tauri::Url::parse(&format!("http://local/?{query}"))
        .unwrap()
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    if params.get("token") != Some(&token) {
        return Ok(response(
            403,
            "Open the link or QR code shown in FreeShow.",
            "text/plain",
        ));
    }
    if path == "/" && request.method() == "GET" {
        return Ok(response(
            200,
            include_str!("remote.html"),
            "text/html; charset=utf-8",
        ));
    }
    if path == "/connect" && request.method() == "POST" {
        let mut clients = clients.lock().unwrap();
        let stale: Vec<_> = clients
            .iter()
            .filter(|(_, c)| c.seen.elapsed().as_secs() > 60)
            .map(|(id, _)| id.clone())
            .collect();
        for id in stale {
            clients.remove(&id);
            let _ = app.emit_to(
                "main",
                "freeshow-ipc",
                json!({"channel":"REMOTE","msg":{"channel":"DISCONNECT","id":id}}),
            );
        }
        if clients.len() >= 10 {
            return Ok(response(429, "Too many remote connections", "text/plain"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        clients.insert(
            id.clone(),
            Client {
                queue: VecDeque::new(),
                seen: Instant::now(),
            },
        );
        drop(clients);
        let _=app.emit_to("main","freeshow-ipc",json!({"channel":"REMOTE","msg":{"channel":"CONNECTION","id":id,"data":{"name":"Local remote"}}}));
        return Ok(response(
            200,
            json!({"id":id}).to_string(),
            "application/json",
        ));
    }
    let id = params.get("id").cloned().unwrap_or_default();
    {
        let mut clients = clients.lock().unwrap();
        let Some(client) = clients.get_mut(&id) else {
            return Ok(response(
                404,
                "Connection expired. Reload this page.",
                "text/plain",
            ));
        };
        client.seen = Instant::now();
    }
    if path == "/poll" && request.method() == "GET" {
        let messages: Vec<_> = clients
            .lock()
            .unwrap()
            .get_mut(&id)
            .unwrap()
            .queue
            .drain(..)
            .collect();
        return Ok(response(
            200,
            json!(messages).to_string(),
            "application/json",
        ));
    }
    if path == "/message" && request.method() == "POST" {
        let Ok(body) = Limited::new(request.into_body(), 65536).collect().await else {
            return Ok(response(413, "Request too large", "text/plain"));
        };
        let Ok(mut msg) = serde_json::from_slice::<Value>(&body.to_bytes()) else {
            return Ok(response(400, "Invalid JSON", "text/plain"));
        };
        if !msg.is_object() {
            return Ok(response(400, "Invalid message", "text/plain"));
        }
        let channel = msg["channel"].as_str().unwrap_or("");
        if !["PASSWORD", "ACCESS", "SHOW", "OUT"].contains(&channel) {
            return Ok(response(400, "Unsupported remote command", "text/plain"));
        }
        msg["id"] = json!(id);
        let _ = app.emit_to(
            "main",
            "freeshow-ipc",
            json!({"channel":"REMOTE","msg":msg}),
        );
        return Ok(response(200, "{}", "application/json"));
    }
    Ok(response(404, "Not found", "text/plain"))
}
#[tauri::command]
pub async fn remote_send(
    caller: Webview,
    state: State<'_, Remote>,
    msg: Value,
) -> Result<(), String> {
    trusted(&caller)?;
    let guard = state.0.lock().await;
    let Some(server) = guard.as_ref() else {
        return Ok(());
    };
    let mut clients = server.clients.lock().unwrap();
    let target = msg["id"].as_str();
    for (id, client) in clients.iter_mut() {
        if target.is_none_or(|target| target == id) {
            if client.queue.len() >= 128 {
                client.queue.pop_front();
            }
            client.queue.push_back(msg.clone());
        }
    }
    Ok(())
}
#[tauri::command]
pub async fn remote_stop(
    app: tauri::AppHandle,
    caller: Webview,
    state: State<'_, Remote>,
) -> Result<(), String> {
    trusted(&caller)?;
    if let Some(server) = state.0.lock().await.take() {
        server.task.abort();
        for id in server.clients.lock().unwrap().keys() {
            let _ = app.emit_to(
                "main",
                "freeshow-ipc",
                json!({"channel":"REMOTE","msg":{"channel":"DISCONNECT","id":id}}),
            );
        }
    }
    Ok(())
}
