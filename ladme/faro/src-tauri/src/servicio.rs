//! Servicio del sistema: el núcleo de Faro corriendo como root (Linux) o como LocalSystem (Windows),
//! para cualquier cuenta.
//!
//! Lo instala TI una vez (`sudo bash instalar-linux.sh`, o `instalar-windows.ps1` como administrador):
//! el sistema lo arranca con el equipo (`ladme-faro … --servicio`). Guarda el vínculo y el estado en una
//! carpeta que solo lee el sistema, habla con el servidor, se actualiza solo y verifica las claves.
//! La interfaz de cada sesión (la isla y las pantallas) se conecta por un socket local
//! (/run/ladme-faro/faro.sock, o la tubería \\.\pipe\ladme-faro): recibe el paquete de cada cambio y
//! pide las acciones. Si alguien cierra la interfaz de la sesión activa, el servicio la vuelve a abrir
//! y lo anota. Lo propio de cada sistema está en servicio_linux.rs y servicio_windows.rs.
//!
//! Protocolo: una línea JSON por mensaje.
//!   interfaz → servicio  {"op":"hola","inactivo":12}
//!                        {"op":"pedir","id":7,"nombre":"accion_isla","args":{…}}
//!                        {"op":"resumen","id":1}   {"op":"orden","id":2,"orden":{…}}   (línea de comandos)
//!   servicio → interfaz  {"senal":"paquete","datos":{…}}   {"id":7,"ok":true,"valor":…}

use crate::{cli, registro, vigia, Compartido, Ctx, Senal};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::broadcast;

#[cfg(unix)]
#[path = "servicio_linux.rs"]
mod sistema;
#[cfg(windows)]
#[path = "servicio_windows.rs"]
mod sistema;

pub use sistema::{carpeta, instalado, programa};

/// Una conexión con el servicio (socket de Unix o tubería con nombre).
pub trait Flujo: AsyncRead + AsyncWrite + Send + Unpin {}
impl<T: AsyncRead + AsyncWrite + Send + Unpin> Flujo for T {}

/// Quién está del otro lado de cada conexión (uid en Linux, sesión en Windows) y cuántos segundos lleva
/// sin tocar el equipo.
type Sesiones = Arc<Mutex<HashMap<u32, (Instant, Option<u64>)>>>;

/// `ladme-faro --servicio`: en Windows, primero se presenta al administrador de servicios.
pub fn entrada() {
    sistema::entrada()
}

/// La interfaz se conecta al servicio.
pub async fn conectar() -> std::io::Result<Box<dyn Flujo>> {
    sistema::conectar().await
}

pub(crate) fn correr() {
    let carpeta = carpeta();
    let _ = std::fs::create_dir_all(&carpeta);
    sistema::proteger_carpeta(&carpeta);
    registro::iniciar(&carpeta);
    registro::info(format!("Servicio de Faro {} arrancó", env!("CARGO_PKG_VERSION")));
    vigia::escribir_pid(&carpeta, "faro.pid");
    sistema::limpiar_anterior();

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

        // Al reiniciar, el servicio sale y el sistema lo vuelve a abrir; al detener, se detiene.
        let mut rx = tx.subscribe();
        tokio::spawn(async move {
            while let Ok(s) = rx.recv().await {
                match s {
                    Senal::Reiniciar => {
                        tokio::time::sleep(Duration::from_millis(800)).await;
                        sistema::reiniciar();
                    }
                    Senal::Detener => {
                        tokio::time::sleep(Duration::from_millis(800)).await;
                        sistema::detener();
                    }
                    _ => {}
                }
            }
        });

        let (ctx2, c2) = (ctx.clone(), compartido.clone());
        let r = sistema::escuchar(move |con, quien| {
            tokio::spawn(atender(con, quien, ctx2.clone(), c2.clone(), tx.subscribe(), sesiones.clone()));
        })
        .await;
        if let Err(e) = r {
            registro::error(format!("El servicio no pudo abrir su conexión local: {e}"));
        }
    });
}

async fn atender(con: Box<dyn Flujo>, uid: u32, ctx: Ctx, c: Compartido, mut rx: broadcast::Receiver<Senal>, sesiones: Sesiones) {
    let (lector, mut escritor) = tokio::io::split(con);
    // Solo la interfaz dice «hola»; la línea de comandos de la misma cuenta no la borra al irse.
    let mut interfaz = false;
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
                interfaz = true;
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
    if interfaz {
        sesiones.lock().unwrap().remove(&uid);
    }
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
    let (lector, mut escritor) = sistema::conectar_bloqueante().map_err(|_| format!("The Faro service is not running ({}).", sistema::COMO_INICIAR))?;
    let mut op = op;
    op["id"] = json!(1);
    escritor.write_all(format!("{op}\n").as_bytes()).map_err(|e| e.to_string())?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for l in std::io::BufReader::new(lector).lines() {
            let Ok(l) = l else { break };
            let Ok(m) = serde_json::from_str::<Value>(&l) else { continue };
            if m["id"] == json!(1) {
                let _ = tx.send(m);
                return;
            }
        }
    });
    let m = rx.recv_timeout(espera).map_err(|_| "The Faro service did not answer in time.".to_string())?;
    drop(escritor);
    if m["ok"].as_bool().unwrap_or(false) {
        Ok(m["valor"].clone())
    } else {
        Err(m["error"].as_str().unwrap_or("error").to_string())
    }
}

/// ¿Responde el servicio?
pub fn vivo() -> bool {
    sistema::conectar_bloqueante().is_ok()
}

// ------------------------------------------------------------------ la interfaz de la sesión activa

/// Si la interfaz de la sesión activa deja de hablar, se vuelve a abrir. Si estaba viva y desapareció
/// (alguien la cerró), queda anotado y el panel lo ve; si nunca llegó a abrir, solo se reintenta.
async fn guardian(c: Compartido, sesiones: Sesiones) {
    let arranque = Instant::now();
    let mut ultimo_intento: Option<Instant> = None;
    let mut vistas: std::collections::HashSet<u32> = Default::default();
    loop {
        tokio::time::sleep(Duration::from_secs(5)).await;
        // (también sin vínculo: la interfaz es la que muestra la ventana para vincular)
        if arranque.elapsed() < sistema::ESPERA_GUARDIAN {
            continue;
        }
        let Some((usuario, quien)) = tokio::task::spawn_blocking(sistema::sesion_activa).await.ok().flatten() else { continue };
        let viva = sesiones.lock().unwrap().get(&quien).is_some_and(|(t, _)| t.elapsed() < Duration::from_secs(20));
        if viva {
            vistas.insert(quien);
            continue;
        }
        if vistas.remove(&quien) {
            registro::aviso(format!("La interfaz de Faro se cerró en la sesión de {usuario}: se vuelve a abrir"));
            c.lock().unwrap().pendientes.push(("cierre_forzado".into(), json!({ "detalle": format!("La interfaz de Faro se cerró en la sesión de {usuario} y el servicio la volvió a abrir") })));
        } else if ultimo_intento.is_some_and(|t| t.elapsed() < Duration::from_secs(60)) {
            continue;
        }
        ultimo_intento = Some(Instant::now());
        if let Err(e) = tokio::task::spawn_blocking(move || sistema::abrir_interfaz(&usuario, quien)).await.unwrap_or(Ok(())) {
            registro::aviso(format!("No se pudo abrir la interfaz de Faro: {e}"));
        }
    }
}

// ------------------------------------------------------------------ actualizaciones

/// Busca versiones nuevas (las mismas releases firmadas que usa Faro por cuenta), verifica la firma y
/// reemplaza el programa cuando nadie usa el equipo con una reserva. Luego sale: el sistema abre el
/// servicio nuevo y las interfaces se reinician.
async fn actualizar(ctx: Ctx, c: Compartido) {
    let (Some(clave), Some(url)) = (option_env!("FARO_UPDATER_PUBKEY"), option_env!("FARO_UPDATER_URL")) else { return };
    if clave.is_empty() || url.is_empty() || !programa().is_file() {
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
                match sistema::instalar(&programa) {
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
    let plataforma = sistema::PLATAFORMAS.iter().map(|k| &p[*k]).find(|v| v.is_object()).unwrap_or(&Value::Null);
    let (Some(descarga), Some(firma)) = (plataforma["url"].as_str(), plataforma["signature"].as_str()) else {
        return Err(format!("el manifiesto no trae {}", sistema::PLATAFORMAS[0]));
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
