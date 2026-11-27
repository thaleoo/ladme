//! Servicio del sistema (Linux): el núcleo de Faro corriendo como root, para cualquier cuenta.
//!
//! Lo instala TI una vez (`sudo bash instalar-linux.sh`): systemd lo arranca con el equipo
//! (`ladme-faro-servicio.service`, `ExecStart=… --servicio`). Guarda el vínculo y el estado en
//! /var/lib/ladme-faro (solo root), habla con el servidor, se actualiza solo y verifica las claves.
//! La interfaz de cada sesión (la isla y las pantallas, `ladme-faro.service` de cada cuenta) se conecta
//! por el socket /run/ladme-faro/faro.sock: recibe el paquete de cada cambio y pide las acciones.
//! Si alguien cierra la interfaz de la sesión activa, el servicio la vuelve a abrir y lo anota.
//!
//! Protocolo: una línea JSON por mensaje.
//!   interfaz → servicio  {"op":"hola","inactivo":12}
//!                        {"op":"pedir","id":7,"nombre":"accion_isla","args":{…}}
//!                        {"op":"resumen","id":1}   {"op":"orden","id":2,"orden":{…}}   (línea de comandos)
//!   servicio → interfaz  {"senal":"paquete","datos":{…}}   {"id":7,"ok":true,"valor":…}

use crate::{cli, registro, vigia, Compartido, Ctx, Senal};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::broadcast;

pub const CARPETA: &str = "/var/lib/ladme-faro";
pub const SOCKET: &str = "/run/ladme-faro/faro.sock";
/// Donde el instalador deja el programa (el servicio lo reemplaza al actualizarse).
pub const PROGRAMA: &str = "/opt/ladme-faro/ladme-faro.AppImage";

/// ¿Está instalado el servicio del sistema en este equipo?
pub fn instalado() -> bool {
    Path::new("/etc/systemd/system/ladme-faro-servicio.service").is_file()
}

/// Quién está del otro lado de cada conexión (uid) y cuántos segundos lleva sin tocar el equipo.
type Sesiones = Arc<Mutex<HashMap<u32, (Instant, Option<u64>)>>>;

pub fn correr() {
    let carpeta = PathBuf::from(CARPETA);
    let _ = std::fs::create_dir_all(&carpeta);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&carpeta, std::fs::Permissions::from_mode(0o700));
    }
    registro::iniciar(&carpeta);
    registro::info(format!("Servicio de Faro {} arrancó", env!("CARGO_PKG_VERSION")));
    vigia::escribir_pid(&carpeta, "faro.pid");

    let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("tokio");
    rt.block_on(async move {
        let (tx, _) = broadcast::channel::<Senal>(64);
        let emisor = tx.clone();
        let ctx = Ctx {
            salida: Arc::new(move |s| {
                let _ = emisor.send(s);
            }),
            actualizar: Arc::new(tokio::sync::Notify::new()),
            servicio: true,
        };
        let compartido = crate::nuevo_nucleo(carpeta.clone(), false);
        let sesiones: Sesiones = Arc::new(Mutex::new(HashMap::new()));

        // La inactividad del equipo es la de la sesión más reciente que se reportó.
        let s2 = sesiones.clone();
        let inactividad: crate::Inactividad = Arc::new(move || {
            let mapa = s2.lock().unwrap();
            mapa.values().filter(|(t, _)| t.elapsed() < Duration::from_secs(10)).filter_map(|(_, i)| *i).min()
        });
        tokio::spawn(crate::ciclo(ctx.clone(), compartido.clone(), inactividad));
        tokio::spawn(actualizar(ctx.clone(), compartido.clone()));
        tokio::spawn(guardian(compartido.clone(), sesiones.clone()));

        // Al reiniciar o detener, el servicio sale (systemd lo vuelve a abrir, o no si se detuvo).
        let mut rx = tx.subscribe();
        tokio::spawn(async move {
            while let Ok(s) = rx.recv().await {
                match s {
                    Senal::Reiniciar => {
                        tokio::time::sleep(Duration::from_millis(800)).await;
                        std::process::exit(0);
                    }
                    Senal::Detener => {
                        tokio::time::sleep(Duration::from_millis(800)).await;
                        let _ = std::process::Command::new("systemctl").args(["stop", "ladme-faro-servicio.service"]).spawn();
                    }
                    _ => {}
                }
            }
        });

        let _ = std::fs::create_dir_all("/run/ladme-faro");
        let _ = std::fs::remove_file(SOCKET);
        let oyente = match UnixListener::bind(SOCKET) {
            Ok(o) => o,
            Err(e) => {
                registro::error(format!("No se pudo abrir el socket {SOCKET}: {e}"));
                return;
            }
        };
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            // Cualquier cuenta conecta su interfaz; lo que cambia algo pide clave o lo decide el servidor.
            let _ = std::fs::set_permissions(SOCKET, std::fs::Permissions::from_mode(0o666));
        }
        loop {
            if let Ok((con, _)) = oyente.accept().await {
                tokio::spawn(atender(con, ctx.clone(), compartido.clone(), tx.subscribe(), sesiones.clone()));
            }
        }
    });
}

async fn atender(con: UnixStream, ctx: Ctx, c: Compartido, mut rx: broadcast::Receiver<Senal>, sesiones: Sesiones) {
    let uid = con.peer_cred().map(|p| p.uid()).unwrap_or(u32::MAX);
    let (lector, mut escritor) = con.into_split();
    let (tx, mut cola) = tokio::sync::mpsc::unbounded_channel::<String>();
    // Al conectar, el paquete actual.
    let _ = tx.send(json!({ "senal": "paquete", "datos": serde_json::to_value(crate::paquete(&c.lock().unwrap())).unwrap_or(Value::Null) }).to_string());
    let tx2 = tx.clone();
    tokio::spawn(async move {
        while let Ok(s) = rx.recv().await {
            if tx2.send(serde_json::to_string(&s).unwrap_or_default()).is_err() {
                break;
            }
        }
    });
    tokio::spawn(async move {
        while let Some(l) = cola.recv().await {
            if escritor.write_all(format!("{l}\n").as_bytes()).await.is_err() {
                break;
            }
        }
    });
    let mut lineas = BufReader::new(lector).lines();
    while let Ok(Some(l)) = lineas.next_line().await {
        let Ok(m) = serde_json::from_str::<Value>(&l) else { continue };
        let id = m["id"].clone();
        match m["op"].as_str() {
            Some("hola") => {
                sesiones.lock().unwrap().insert(uid, (Instant::now(), m["inactivo"].as_u64()));
            }
            Some("pedir") => {
                let (ctx, c, tx) = (ctx.clone(), c.clone(), tx.clone());
                let nombre = m["nombre"].as_str().unwrap_or("").to_string();
                let args = m["args"].clone();
                tokio::spawn(async move {
                    let r = crate::despachar(&ctx, &c, &nombre, args).await;
                    let _ = tx.send(respuesta(&id, r));
                });
            }
            Some("resumen") => {
                let _ = tx.send(respuesta(&id, Ok(resumen(&c))));
            }
            Some("orden") => {
                let r = match serde_json::from_value::<cli::OrdenCli>(m["orden"].clone()) {
                    Ok(o) => {
                        let (r, despues, vincular_ya) = crate::procesar_orden(&ctx, &c, &o);
                        if vincular_ya {
                            c.lock().unwrap().forzar = true;
                        }
                        match despues {
                            Some("reiniciar") => ctx.avisar(Senal::Reiniciar),
                            Some("detener") => ctx.avisar(Senal::Detener),
                            _ => {}
                        }
                        r
                    }
                    Err(_) => Err("Orden inválida.".into()),
                };
                let _ = tx.send(respuesta(&id, r.map(Value::from)));
            }
            _ => {}
        }
    }
    sesiones.lock().unwrap().remove(&uid);
}

fn respuesta(id: &Value, r: Result<Value, String>) -> String {
    match r {
        Ok(v) => json!({ "id": id, "ok": true, "valor": v }),
        Err(e) => json!({ "id": id, "ok": false, "error": e }),
    }
    .to_string()
}

/// La configuración y el estado para `faro status` y `faro doctor`, sin secretos: el token, las claves
/// (aunque vayan con hash), el secreto del QR y los comandos pendientes no salen del servicio.
fn resumen(c: &Compartido) -> Value {
    let n = c.lock().unwrap();
    let mut cfg = n.config.clone();
    cfg.token = cfg.token.map(|_| "-".into());
    cfg.codigo_vinculo = None;
    let mut copia = n.copia.clone();
    if let Some(r) = copia.remoto.as_mut() {
        r.clave = None;
        r.qr = None;
        r.claves_temporales.clear();
        r.comandos.clear();
        if let Some(a) = r.actual.as_mut() {
            a.desbloqueo = None;
        }
    }
    json!({ "version": env!("CARGO_PKG_VERSION"), "cfg": cfg, "copia": copia })
}

/// La línea de comandos le habla al servicio: una petición, una respuesta (se saltan las señales).
pub fn preguntar(op: Value, espera: Duration) -> Result<Value, String> {
    use std::io::{BufRead, Write};
    let mut con = std::os::unix::net::UnixStream::connect(SOCKET).map_err(|_| "The Faro service is not running (sudo systemctl start ladme-faro-servicio).".to_string())?;
    con.set_read_timeout(Some(espera)).ok();
    let mut op = op;
    op["id"] = json!(1);
    con.write_all(format!("{op}\n").as_bytes()).map_err(|e| e.to_string())?;
    for l in std::io::BufReader::new(con).lines() {
        let l = l.map_err(|_| "The Faro service did not answer in time.".to_string())?;
        let Ok(m) = serde_json::from_str::<Value>(&l) else { continue };
        if m["id"] == json!(1) {
            return if m["ok"].as_bool().unwrap_or(false) { Ok(m["valor"].clone()) } else { Err(m["error"].as_str().unwrap_or("error").to_string()) };
        }
    }
    Err("The Faro service closed the connection.".into())
}

/// ¿Responde el servicio?
pub fn vivo() -> bool {
    std::os::unix::net::UnixStream::connect(SOCKET).is_ok()
}

// ------------------------------------------------------------------ la interfaz de la sesión activa

/// Usuario y uid de la sesión gráfica activa del puesto (loginctl).
fn sesion_activa() -> Option<(String, u32)> {
    let salida = |args: &[&str]| std::process::Command::new("loginctl").args(args).output().ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    let id = salida(&["show-seat", "seat0", "-p", "ActiveSession", "--value"])?;
    if id.is_empty() {
        return None;
    }
    let info = salida(&["show-session", &id, "-p", "Name", "-p", "User", "-p", "Type", "-p", "Class"])?;
    let campo = |k: &str| info.lines().find_map(|l| l.strip_prefix(&format!("{k}=")).map(String::from));
    let tipo = campo("Type")?;
    if !(tipo == "x11" || tipo == "wayland") || campo("Class").as_deref() != Some("user") {
        return None;
    }
    Some((campo("Name")?, campo("User")?.parse().ok()?))
}

/// Si la interfaz de la sesión activa deja de hablar, se vuelve a abrir. Si estaba viva y desapareció
/// (alguien la cerró), queda anotado y el panel lo ve; si nunca llegó a abrir, solo se reintenta.
async fn guardian(c: Compartido, sesiones: Sesiones) {
    let arranque = Instant::now();
    let mut ultimo_intento: Option<Instant> = None;
    let mut vistas: std::collections::HashSet<u32> = Default::default();
    loop {
        tokio::time::sleep(Duration::from_secs(5)).await;
        if arranque.elapsed() < Duration::from_secs(40) || c.lock().unwrap().config.token.is_none() {
            continue;
        }
        let Some((usuario, uid)) = tokio::task::spawn_blocking(sesion_activa).await.ok().flatten() else { continue };
        let viva = sesiones.lock().unwrap().get(&uid).is_some_and(|(t, _)| t.elapsed() < Duration::from_secs(20));
        if viva {
            vistas.insert(uid);
            continue;
        }
        if vistas.remove(&uid) {
            registro::aviso(format!("La interfaz de Faro se cerró en la sesión de {usuario}: se vuelve a abrir"));
            c.lock().unwrap().pendientes.push(("cierre_forzado".into(), json!({ "detalle": format!("La interfaz de Faro se cerró en la sesión de {usuario} y el servicio la volvió a abrir") })));
        } else if ultimo_intento.is_some_and(|t| t.elapsed() < Duration::from_secs(60)) {
            continue;
        }
        ultimo_intento = Some(Instant::now());
        let _ = std::process::Command::new("systemctl").args(["--user", "-M", &format!("{usuario}@"), "start", "ladme-faro.service"]).status();
    }
}

// ------------------------------------------------------------------ actualizaciones

/// Busca versiones nuevas (las mismas releases firmadas que usa Faro por cuenta), verifica la firma y
/// reemplaza el programa en /opt cuando nadie usa el equipo con una reserva. Luego sale: systemd abre el
/// servicio nuevo y las interfaces se reinician.
async fn actualizar(ctx: Ctx, c: Compartido) {
    let (Some(clave), Some(url)) = (option_env!("FARO_UPDATER_PUBKEY"), option_env!("FARO_UPDATER_URL")) else { return };
    if clave.is_empty() || url.is_empty() || !Path::new(PROGRAMA).is_file() {
        return;
    }
    let pruebas = url.replace("/releases/latest/download/latest.json", "/releases/download/faro-pruebas/latest.json");
    tokio::select! {
        _ = tokio::time::sleep(Duration::from_secs(120)) => {}
        _ = ctx.actualizar.notified() => {}
    }
    loop {
        let canal = c.lock().unwrap().copia.remoto.as_ref().and_then(|r| r.canal.clone()).unwrap_or_default();
        match buscar(if canal == "pruebas" { &pruebas } else { url }, clave).await {
            Ok(Some((version, programa))) => {
                for _ in 0..1440 {
                    let libre = c.lock().unwrap().vista.as_ref().map(|v| {
                        !matches!(v.estado, crate::decision::Estado::Reservado | crate::decision::Estado::PorTerminar | crate::decision::Estado::Gracia)
                    }).unwrap_or(true);
                    if libre {
                        break;
                    }
                    tokio::time::sleep(Duration::from_secs(60)).await;
                }
                match instalar(&programa) {
                    Ok(()) => {
                        registro::info(format!("Instalada la versión {version}: el servicio y las interfaces se reinician"));
                        let (cfg, token) = {
                            let n = c.lock().unwrap();
                            (n.config.clone(), n.config.token.clone())
                        };
                        if let Some(t) = token {
                            let _ = crate::api::Api::new().evento(&cfg, &t, "actualizado", json!({ "de": env!("CARGO_PKG_VERSION"), "a": version })).await;
                        }
                        ctx.avisar(Senal::Reiniciar);
                        return;
                    }
                    Err(e) => registro::error(format!("No se pudo instalar la versión {version}: {e}")),
                }
            }
            Ok(None) => {}
            Err(e) => registro::aviso(format!("No se pudo buscar actualizaciones: {e}")),
        }
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(6 * 3600)) => {}
            _ = ctx.actualizar.notified() => {}
        }
    }
}

/// La versión publicada, si es más nueva, ya descargada y con la firma verificada.
async fn buscar(url: &str, clave: &str) -> Result<Option<(String, Vec<u8>)>, String> {
    let cliente = reqwest::Client::builder().timeout(Duration::from_secs(600)).build().map_err(|e| e.to_string())?;
    let m: Value = cliente.get(url).send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
    let version = m["version"].as_str().unwrap_or("").trim_start_matches('v').to_string();
    if !mas_nueva(&version, env!("CARGO_PKG_VERSION")) {
        return Ok(None);
    }
    let p = &m["platforms"];
    let plataforma = if p["linux-x86_64-appimage"].is_object() { &p["linux-x86_64-appimage"] } else { &p["linux-x86_64"] };
    let (Some(descarga), Some(firma)) = (plataforma["url"].as_str(), plataforma["signature"].as_str()) else {
        return Err("el manifiesto no trae la AppImage de Linux".into());
    };
    let datos = cliente.get(descarga).send().await.map_err(|e| e.to_string())?.bytes().await.map_err(|e| e.to_string())?.to_vec();
    verificar(&datos, firma, clave)?;
    Ok(Some((version, datos)))
}

/// Misma verificación que el actualizador de Tauri: clave pública y firma minisign en base64.
fn verificar(datos: &[u8], firma: &str, clave: &str) -> Result<(), String> {
    use base64::Engine;
    let b64 = |t: &str| -> Result<String, String> {
        let v = base64::engine::general_purpose::STANDARD.decode(t.trim()).map_err(|e| e.to_string())?;
        String::from_utf8(v).map_err(|e| e.to_string())
    };
    let pk = minisign_verify::PublicKey::decode(&b64(clave)?).map_err(|e| format!("clave pública: {e}"))?;
    let sig = minisign_verify::Signature::decode(&b64(firma)?).map_err(|e| format!("firma: {e}"))?;
    pk.verify(datos, &sig, true).map_err(|e| format!("la firma no coincide: {e}"))
}

pub(crate) fn mas_nueva(a: &str, b: &str) -> bool {
    let n = |v: &str| v.split('.').map(|x| x.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    n(a) > n(b)
}

/// Reemplaza el programa sin dejarlo a medias: archivo nuevo al lado y rename.
fn instalar(datos: &[u8]) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let nuevo = PathBuf::from(format!("{PROGRAMA}.nuevo"));
    std::fs::write(&nuevo, datos).map_err(|e| e.to_string())?;
    std::fs::set_permissions(&nuevo, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    std::fs::rename(&nuevo, PROGRAMA).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn compara_versiones() {
        assert!(mas_nueva("0.8.1", "0.8.0") && mas_nueva("0.10.0", "0.9.9") && !mas_nueva("0.8.0", "0.8.0"));
    }

    #[test]
    fn rechaza_una_firma_que_no_es() {
        assert!(verificar(b"hola", "no-es-base64", "tampoco").is_err());
    }

    /// Clave y firma de prueba en el formato de Tauri (texto de minisign en base64, firma con hash previo).
    const CLAVE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXkgMDgwNzA2MDUwNDAzMDIwMQpSV1FCQWdNRUJRWUhDQU9oQjcvenpoQytIWERkR09kTHdKbG41Tll3bTZVTlh4M2NobVFTVlRHNAo=";
    const FIRMA: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRQkFnTUVCUVlIQ0xDZzYwU2NzaDNSUHFXejVlYitZbFRtZ0FpS0FPR29hUVZ0Ui9MaWVCcmVwaUZHbkFOYnRvK05LUDBhU2dXY1dYSDNuSHhJWlVYcWtXcS8vYzEyTVEwPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxCWZpbGU6ZmFyby5BcHBJbWFnZQpWWk1jK3pXRGhiSFZOR2dUblQ2VWN6M3dMTWhHd0UvUkRHaEdGRWcwdnI5TUMxWlBkZXR0bzZwMjd1eUxqTFAvdEhzQ1R5UnRveE5WRHo1ZWdnOVlEdz09Cg==";

    #[test]
    fn verifica_firmas_de_tauri() {
        assert!(verificar(b"faro", FIRMA, CLAVE).is_ok());
        assert!(verificar(b"faro!", FIRMA, CLAVE).is_err());
    }
}
