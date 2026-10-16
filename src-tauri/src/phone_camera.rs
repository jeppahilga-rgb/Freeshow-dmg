use bytes::Bytes;
use http_body_util::{BodyExt, Full, Limited};
use hyper::{body::Incoming, server::conn::http1, service::service_fn, Request, Response};
use hyper_util::rt::TokioIo;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, VecDeque},
    convert::Infallible,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Manager, State, Webview};

#[derive(Default)]
struct Session {
    phone: VecDeque<Value>,
    receivers: HashMap<String, VecDeque<Value>>,
}
type Sessions = Arc<Mutex<HashMap<String, Session>>>;
struct Server {
    sessions: Sessions,
    urls: Vec<String>,
    fingerprint: String,
}
#[derive(Default)]
pub struct PhoneCamera {
    server: Arc<tokio::sync::Mutex<Option<Server>>>,
}
impl PhoneCamera {
    pub fn close_window(&self, label: &str) {
        let server = self.server.clone();
        let prefix = format!("{label}:");
        tauri::async_runtime::spawn(async move {
            let guard = server.lock().await;
            if let Some(server) = guard.as_ref() {
                for session in server.sessions.lock().unwrap().values_mut() {
                    let keys: Vec<_> = session
                        .receivers
                        .keys()
                        .filter(|k| k.starts_with(&prefix))
                        .cloned()
                        .collect();
                    for key in keys {
                        session.receivers.remove(&key);
                        push(&mut session.phone, json!({"type":"close","key":key}));
                    }
                }
            }
        });
    }
}
fn trusted(caller: &Webview) -> Result<(), String> {
    if caller.label() == caller.window().label()
        && (caller.label() == "main" || caller.label().starts_with("output-"))
    {
        Ok(())
    } else {
        Err("Editor/output only".into())
    }
}
fn push(queue: &mut VecDeque<Value>, value: Value) {
    if queue.len() >= 256 {
        queue.pop_front();
    }
    queue.push_back(value);
}
fn response(status: u16, mime: &str, body: impl Into<Bytes>) -> Response<Full<Bytes>> {
    Response::builder()
        .status(status)
        .header("Content-Type", mime)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .body(Full::new(body.into()))
        .unwrap()
}
async fn handle(
    req: Request<Incoming>,
    sessions: Sessions,
    certificate: Bytes,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let path = req.uri().path().to_string();
    let query: HashMap<_, _> = tauri::Url::parse(&format!("https://localhost{}", req.uri()))
        .unwrap()
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    let id = query.get("token").cloned().unwrap_or_default();
    if !sessions.lock().unwrap().contains_key(&id) {
        return Ok(response(
            403,
            "text/plain",
            "Pair this phone from FreeShow first.",
        ));
    }
    if path == "/certificate.cer" && req.method() == hyper::Method::GET {
        return Ok(Response::builder()
            .header("Content-Type", "application/x-x509-ca-cert")
            .header(
                "Content-Disposition",
                "attachment; filename=FreeShow-local-camera.cer",
            )
            .body(Full::new(certificate))
            .unwrap());
    }
    if path == "/" && req.method() == hyper::Method::GET {
        return Ok(Response::builder().header("Content-Type", "text/html; charset=utf-8").header("Cache-Control", "no-store").header("Content-Security-Policy", "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; media-src blob:; connect-src 'self'; frame-ancestors 'none'").body(Full::new(Bytes::from_static(include_bytes!("phone.html")))).unwrap());
    }
    if path == "/poll" && req.method() == hyper::Method::GET {
        let messages: Vec<_> = sessions
            .lock()
            .unwrap()
            .get_mut(&id)
            .unwrap()
            .phone
            .drain(..)
            .collect();
        return Ok(response(
            200,
            "application/json",
            serde_json::to_vec(&messages).unwrap(),
        ));
    }
    if path == "/signal" && req.method() == hyper::Method::POST {
        let Ok(body) = Limited::new(req.into_body(), 65536).collect().await else {
            return Ok(response(413, "text/plain", "Message too large"));
        };
        let Ok(value) = serde_json::from_slice::<Value>(&body.to_bytes()) else {
            return Ok(response(400, "text/plain", "Invalid message"));
        };
        let key = value.get("key").and_then(Value::as_str).unwrap_or("");
        let mut guard = sessions.lock().unwrap();
        let session = guard.get_mut(&id).unwrap();
        if let Some(queue) = session.receivers.get_mut(key) {
            push(queue, value);
        }
        return Ok(response(200, "application/json", "{}"));
    }
    Ok(response(404, "text/plain", "Not found"))
}
async fn start_server(folder: std::path::PathBuf) -> Result<Server, String> {
    let interfaces = local_ip_address::list_afinet_netifas().map_err(|e| e.to_string())?;
    let mut ips: Vec<String> = interfaces
        .into_iter()
        .filter_map(|(_, ip)| match ip {
            std::net::IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_link_local() => {
                Some(ip.to_string())
            }
            _ => None,
        })
        .collect();
    // Prefer common home/hotspot LAN addresses over VPN addresses such as 10.2.0.2.
    // Retain every usable address so multi-adapter users can override the choice.
    ips.sort_by_key(|address| address_rank(address));
    ips.dedup();
    let listener = match tokio::net::TcpListener::bind("0.0.0.0:43187").await {
        Ok(l) => l,
        Err(_) => tokio::net::TcpListener::bind("0.0.0.0:0")
            .await
            .map_err(|e| e.to_string())?,
    };
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let mut names = ips.clone();
    names.extend(["localhost".into(), "127.0.0.1".into()]);
    let cert_path = folder.join("phone-camera-cert.der");
    let key_path = folder.join("phone-camera-key.der");
    let names_path = folder.join("phone-camera-addresses.json");
    let names_bytes = serde_json::to_vec(&names).map_err(|e| e.to_string())?;
    let (cert, key) = if std::fs::read(&names_path).ok().as_ref() == Some(&names_bytes)
        && cert_path.exists()
        && key_path.exists()
    {
        (
            std::fs::read(&cert_path).map_err(|e| e.to_string())?,
            std::fs::read(&key_path).map_err(|e| e.to_string())?,
        )
    } else {
        let key = rcgen::KeyPair::generate().map_err(|e| e.to_string())?;
        let mut params = rcgen::CertificateParams::new(names).map_err(|e| e.to_string())?;
        params
            .distinguished_name
            .push(rcgen::DnType::CommonName, "FreeShow Local Phone Camera");
        params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
        params.key_usages = vec![
            rcgen::KeyUsagePurpose::DigitalSignature,
            rcgen::KeyUsagePurpose::KeyCertSign,
        ];
        params.extended_key_usages = vec![rcgen::ExtendedKeyUsagePurpose::ServerAuth];
        let cert = params
            .self_signed(&key)
            .map_err(|e| e.to_string())?
            .der()
            .to_vec();
        let key = key.serialize_der();
        std::fs::write(&cert_path, &cert).map_err(|e| e.to_string())?;
        std::fs::write(&key_path, &key).map_err(|e| e.to_string())?;
        std::fs::write(&names_path, names_bytes).map_err(|e| e.to_string())?;
        (cert, key)
    };
    let fingerprint = format!("{:x}", Sha256::digest(&cert));
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let certificate = Bytes::from(cert.clone());
    let config = rustls::ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .with_no_client_auth()
        .with_single_cert(
            vec![rustls::pki_types::CertificateDer::from(cert)],
            rustls::pki_types::PrivatePkcs8KeyDer::from(key).into(),
        )
        .map_err(|e| e.to_string())?;
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
    let sessions: Sessions = Arc::default();
    let shared = sessions.clone();
    tauri::async_runtime::spawn(async move {
        while let Ok((socket, _)) = listener.accept().await {
            let acceptor = acceptor.clone();
            let shared = shared.clone();
            let certificate = certificate.clone();
            tauri::async_runtime::spawn(async move {
                if let Ok(Ok(tls)) =
                    tokio::time::timeout(Duration::from_secs(10), acceptor.accept(socket)).await
                {
                    let service = service_fn(move |request| {
                        handle(request, shared.clone(), certificate.clone())
                    });
                    let _ = tokio::time::timeout(
                        Duration::from_secs(30),
                        http1::Builder::new().serve_connection(TokioIo::new(tls), service),
                    )
                    .await;
                }
            });
        }
    });
    ips.push("127.0.0.1".into());
    Ok(Server {
        sessions,
        fingerprint,
        urls: ips
            .into_iter()
            .map(|ip| format!("https://{ip}:{port}/"))
            .collect(),
    })
}
fn address_rank(address: &str) -> (u8, String) {
    let rank = match address.parse::<std::net::Ipv4Addr>() {
        Ok(ip) if ip.octets()[0] == 192 && ip.octets()[1] == 168 => 0,
        Ok(ip) if ip.octets()[0] == 172 && (16..=31).contains(&ip.octets()[1]) => 1,
        Ok(ip) if ip.octets()[0] == 10 => 2,
        _ => 3,
    };
    (rank, address.to_owned())
}
#[cfg(test)]
mod address_tests {
    #[test]
    fn prefers_lan_over_vpn() {
        let mut addresses = vec!["10.2.0.2", "192.168.100.60", "172.20.10.2"];
        addresses.sort_by_key(|address| super::address_rank(address));
        assert_eq!(addresses, vec!["192.168.100.60", "172.20.10.2", "10.2.0.2"]);
    }
}
#[tauri::command]
pub async fn phone_camera_start(
    app: tauri::AppHandle,
    caller: Webview,
    state: State<'_, PhoneCamera>,
    id: Option<String>,
) -> Result<Value, String> {
    trusted(&caller)?;
    let id = id.unwrap_or_else(|| format!("phone-{}", uuid::Uuid::new_v4()));
    uuid::Uuid::parse_str(id.strip_prefix("phone-").ok_or("Invalid camera ID")?)
        .map_err(|e| e.to_string())?;
    let mut guard = state.server.lock().await;
    if guard.is_none() {
        *guard = Some(start_server(app.path().app_data_dir().map_err(|e| e.to_string())?).await?);
    }
    let server = guard.as_ref().unwrap();
    let mut sessions = server.sessions.lock().unwrap();
    if sessions.len() >= 32 && !sessions.contains_key(&id) {
        return Err("Maximum 32 phone cameras".into());
    }
    sessions.entry(id.clone()).or_default();
    Ok(
        json!({"id":id,"urls":server.urls.iter().map(|url|format!("{url}?token={id}&fingerprint={}",server.fingerprint)).collect::<Vec<_>>() }),
    )
}
#[tauri::command]
pub async fn phone_camera_signal(
    caller: Webview,
    state: State<'_, PhoneCamera>,
    id: String,
    key: String,
    message: Option<Value>,
) -> Result<Value, String> {
    trusted(&caller)?;
    let owner = format!("{}:", caller.label());
    if !key.starts_with(&owner) || key.len() > 150 {
        return Err("Invalid receiver".into());
    }
    let guard = state.server.lock().await;
    let server = guard.as_ref().ok_or("Phone connection not started")?;
    let mut sessions = server.sessions.lock().unwrap();
    let session = sessions.get_mut(&id).ok_or("Unknown phone")?;
    if let Some(mut message) = message {
        if message.get("type").and_then(Value::as_str) == Some("close") {
            session.receivers.remove(&key);
        } else {
            if session.receivers.len() >= 32 && !session.receivers.contains_key(&key) {
                return Err("Too many receivers".into());
            }
            session.receivers.entry(key.clone()).or_default();
        }
        message["key"] = json!(key);
        push(&mut session.phone, message);
        Ok(json!([]))
    } else {
        let values: Vec<_> = session
            .receivers
            .entry(key)
            .or_default()
            .drain(..)
            .collect();
        Ok(json!(values))
    }
}
