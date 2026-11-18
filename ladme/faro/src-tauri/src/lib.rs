//! Faro: la isla de LADME en cada PC de la sala.
//!
//! - Cada 30 s (10 s mientras está bloqueado) pregunta a Supabase qué pasa con su equipo.
//! - Cada segundo decide qué mostrar (`decision::decidir`) con la última respuesta.
//! - Muestra la isla arriba de la pantalla y, en modo bloquear, una pantalla de bloqueo
//!   en cada monitor. Nunca cierra la sesión ni detiene programas: solo cubre la pantalla.

mod api;
mod clave;
mod config;
mod decision;
mod inactividad;
mod vigia;

pub use vigia::ARG as ARG_VIGIA;

/// Punto de entrada del vigía (ver `vigia.rs`).
pub fn correr_vigia(carpeta: PathBuf) {
    vigia::correr(carpeta)
}

use api::{Api, Fallo};
use chrono::{Duration as Dur, Utc};
use config::{Config, Copia};
use decision::{Entrada, Pantalla, Vista};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
#[cfg(not(target_os = "linux"))]
use tauri_plugin_opener::OpenerExt;

const ISLA: &str = "isla";
const VINCULAR: &str = "vincular";
const PREFIJO_BLOQUEO: &str = "bloqueo-";
/// Cuánto dura un desbloqueo con la clave de emergencia.
const EMERGENCIA_HORAS: i64 = 2;

struct Nucleo {
    carpeta: PathBuf,
    config: Config,
    copia: Copia,
    ultimo_ok: Option<Instant>,
    vista: Option<Vista>,
    pendientes: Vec<(String, Value)>,
    forzar: bool,
    intentos_fallidos: u32,
    espera_hasta: Option<Instant>,
}

type Compartido = Arc<Mutex<Nucleo>>;

#[derive(Serialize, Clone)]
struct Paquete {
    vista: Option<Vista>,
    desfase_ms: i64,
    qr: Option<String>,
    url_qr: Option<String>,
    version: &'static str,
    vinculado: bool,
    clave_disponible: bool,
}

/// systemd define INVOCATION_ID en los servicios que lanza.
fn gestionado_por_systemd() -> bool {
    cfg!(target_os = "linux") && std::env::var_os("INVOCATION_ID").is_some()
}

fn host() -> String {
    std::env::var("COMPUTERNAME")
        .ok()
        .or_else(|| std::fs::read_to_string("/etc/hostname").ok())
        .map(|h| h.trim().to_string())
        .unwrap_or_default()
}

fn sistema() -> String {
    let i = os_info::get();
    match i.edition() {
        Some(ed) => format!("{ed} ({})", i.version()),
        None => format!("{} {}", i.os_type(), i.version()),
    }
}

fn qr_svg(url: &str) -> Option<String> {
    use qrcode::render::svg;
    let codigo = qrcode::QrCode::with_error_correction_level(url.as_bytes(), qrcode::EcLevel::M).ok()?;
    Some(
        codigo
            .render::<svg::Color>()
            .min_dimensions(220, 220)
            .quiet_zone(false)
            .dark_color(svg::Color("#0b0b10"))
            .light_color(svg::Color("#ffffff"))
            .build(),
    )
}

fn paquete(n: &Nucleo) -> Paquete {
    let url_qr = n.vista.as_ref().and_then(|v| n.config.url_pwa(&v.ruta_qr));
    Paquete {
        vista: n.vista.clone(),
        desfase_ms: n.copia.desfase_ms,
        qr: url_qr.as_deref().and_then(qr_svg),
        url_qr,
        version: env!("CARGO_PKG_VERSION"),
        vinculado: n.config.token.is_some(),
        clave_disponible: n.copia.remoto.as_ref().and_then(|r| r.clave.as_ref()).is_some(),
    }
}

// ------------------------------------------------------------------ ventanas

fn crear_isla(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(w) = app.get_webview_window(ISLA) {
        return Ok(w);
    }
    let w = WebviewWindowBuilder::new(app, ISLA, WebviewUrl::App("isla.html".into()))
        .title("Faro")
        .inner_size(380.0, 64.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .build()?;
    centrar_isla(&w);
    Ok(w)
}

fn centrar_isla(w: &WebviewWindow) {
    let Ok(Some(m)) = w.primary_monitor().or_else(|_| w.current_monitor()) else { return };
    let Ok(t) = w.outer_size() else { return };
    let escala = m.scale_factor();
    let x = m.position().x + (m.size().width as i32 - t.width as i32) / 2;
    let y = m.position().y + (6.0 * escala) as i32;
    let _ = w.set_position(PhysicalPosition::new(x, y));
}

fn abrir_vincular(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(VINCULAR) {
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(app, VINCULAR, WebviewUrl::App("vincular.html".into()))
        .title("Faro · Vincular este equipo")
        .inner_size(460.0, 560.0)
        .resizable(false)
        .center()
        .build();
}

fn ventanas_bloqueo(app: &AppHandle) -> Vec<WebviewWindow> {
    app.webview_windows().into_iter().filter(|(k, _)| k.starts_with(PREFIJO_BLOQUEO)).map(|(_, w)| w).collect()
}

fn mostrar_bloqueo(app: &AppHandle) {
    if !ventanas_bloqueo(app).is_empty() {
        return;
    }
    let Some(base) = app.get_webview_window(ISLA) else { return };
    let monitores = base.available_monitors().unwrap_or_default();
    let principal = base.primary_monitor().ok().flatten();
    for (i, m) in monitores.iter().enumerate() {
        let es_principal = principal.as_ref().map(|p| p.position() == m.position()).unwrap_or(i == 0);
        let pos = m.position().to_logical::<f64>(m.scale_factor());
        let tam = m.size().to_logical::<f64>(m.scale_factor());
        let url = format!("bloqueo.html{}", if es_principal { "?principal=1" } else { "" });
        if let Ok(w) = WebviewWindowBuilder::new(app, format!("{PREFIJO_BLOQUEO}{i}"), WebviewUrl::App(url.into()))
            .title("Faro · Equipo bloqueado")
            .position(pos.x, pos.y)
            .inner_size(tam.width, tam.height)
            .decorations(false)
            .always_on_top(true)
            .visible_on_all_workspaces(true)
            .skip_taskbar(true)
            .resizable(false)
            .focused(es_principal)
            .build()
        {
            let _ = w.set_fullscreen(true);
        }
    }
}

fn quitar_bloqueo(app: &AppHandle) {
    for w in ventanas_bloqueo(app) {
        let _ = w.destroy();
    }
}

/// Lleva la vista a las ventanas: crea o quita el bloqueo y avisa a la isla.
fn aplicar(app: &AppHandle, n: &mut Nucleo, nueva: Vista) {
    let antes = n.vista.as_ref().map(|v| v.pantalla.clone());
    let cubre = nueva.pantalla != Pantalla::Ninguna;
    if antes.as_ref() != Some(&nueva.pantalla) {
        if cubre {
            mostrar_bloqueo(app);
            if let Some(i) = app.get_webview_window(ISLA) {
                let _ = i.hide();
            }
        } else {
            quitar_bloqueo(app);
            if n.config.token.is_some() {
                if let Some(i) = app.get_webview_window(ISLA) {
                    let _ = i.show();
                }
            }
        }
        match (antes, &nueva.pantalla) {
            (_, Pantalla::Bloqueo) => n.pendientes.push(("bloqueo".into(), json!({ "estado": format!("{:?}", nueva.estado) }))),
            (Some(Pantalla::Bloqueo), _) => n.pendientes.push(("desbloqueo".into(), json!({}))),
            _ => {}
        }
    }
    n.copia.bloqueado = nueva.pantalla == Pantalla::Bloqueo;
    let cambio = n.vista.as_ref() != Some(&nueva);
    n.vista = Some(nueva);
    if cambio {
        let _ = app.emit("faro://vista", paquete(n));
    }
    // Que la pantalla de bloqueo no quede detrás de otra ventana.
    if cubre {
        if let Some(w) = ventanas_bloqueo(app).into_iter().find(|w| w.label() == format!("{PREFIJO_BLOQUEO}0")) {
            if !w.is_focused().unwrap_or(true) {
                let _ = w.set_always_on_top(true);
                let _ = w.set_focus();
            }
        }
    }
}

// ------------------------------------------------------------------ ciclo

async fn latir(app: &AppHandle, api: &Api, compartido: &Compartido, inactivo: Option<u64>) {
    let (cfg, token, bloqueado) = {
        let n = compartido.lock().unwrap();
        (n.config.clone(), n.config.token.clone(), n.copia.bloqueado)
    };
    let Some(token) = token else { return };
    let info = json!({ "inactivo_seg": inactivo, "bloqueado": bloqueado, "host": host(), "so": sistema(),
                       "version": env!("CARGO_PKG_VERSION") });
    match api.estado(&cfg, &token, info).await {
        Ok(r) => {
            let pendientes = {
                let mut n = compartido.lock().unwrap();
                let desfase = (r.ahora - Utc::now()).num_milliseconds();
                let ahora = Utc::now() + Dur::milliseconds(desfase);
                let antes = n.copia.remoto.take();
                decision::recordar(&mut n.copia.memoria, antes.as_ref(), Some(&r), ahora);
                n.copia.remoto = Some(r);
                n.copia.desfase_ms = desfase;
                n.copia.recibido_en = Some(Utc::now());
                n.ultimo_ok = Some(Instant::now());
                config::guardar_copia(&n.carpeta, &n.copia);
                std::mem::take(&mut n.pendientes)
            };
            for (i, (tipo, detalle)) in pendientes.iter().enumerate() {
                if let Err(Fallo::Red(_)) = api.evento(&cfg, &token, tipo, detalle.clone()).await {
                    compartido.lock().unwrap().pendientes.extend(pendientes[i..].iter().cloned());
                    break;
                }
            }
        }
        Err(Fallo::NoVinculado) => {
            let mut n = compartido.lock().unwrap();
            n.config.token = None;
            n.config.equipo = None;
            n.copia = Copia::default();
            n.vista = None;
            let _ = config::guardar_vinculo(&n.carpeta, None, None);
            config::guardar_copia(&n.carpeta, &n.copia);
            quitar_bloqueo(app);
            if let Some(i) = app.get_webview_window(ISLA) {
                let _ = i.hide();
            }
            abrir_vincular(app);
        }
        Err(Fallo::Red(e)) => eprintln!("Faro: sin conexión con el servidor ({e})"),
        Err(Fallo::Mensaje(m)) => eprintln!("Faro: el servidor respondió: {m}"),
    }
}

async fn ciclo(app: AppHandle, compartido: Compartido) {
    let api = Api::new();
    let mut ultimo_latido: Option<Instant> = None;
    let mut ultimo_intento_vinculo: Option<Instant> = None;
    let mut ultima_revision_vigia = Instant::now();
    loop {
        let inactivo = inactividad::segundos();
        let (vinculado, carpeta) = {
            let n = compartido.lock().unwrap();
            (n.config.token.is_some(), n.carpeta.clone())
        };
        if !vinculado && ultimo_intento_vinculo.map(|t| t.elapsed() > Duration::from_secs(30)).unwrap_or(true) {
            ultimo_intento_vinculo = Some(Instant::now());
            vincular_solo(&app, &api, &compartido).await;
        }
        // El vigía solo acompaña a un Faro vinculado y en la versión instalada.
        if vinculado && cfg!(not(debug_assertions)) && !gestionado_por_systemd() && ultima_revision_vigia.elapsed() >= Duration::from_secs(3) {
            ultima_revision_vigia = Instant::now();
            vigia::asegurar(&carpeta);
        }
        let (vinculado, toca) = {
            let mut n = compartido.lock().unwrap();
            let cada = if n.copia.bloqueado { 10 } else { 30 };
            let toca = n.forzar || ultimo_latido.map(|t| t.elapsed() >= Duration::from_secs(cada)).unwrap_or(true);
            n.forzar = false;
            (n.config.token.is_some(), toca)
        };
        if vinculado && toca {
            ultimo_latido = Some(Instant::now());
            latir(&app, &api, &compartido, inactivo).await;
        }
        {
            let mut n = compartido.lock().unwrap();
            if n.config.token.is_some() {
                let ahora = Utc::now() + Dur::milliseconds(n.copia.desfase_ms);
                let en_linea = n.ultimo_ok.map(|t| t.elapsed() < Duration::from_secs(90)).unwrap_or(false);
                let vista = decision::decidir(&Entrada {
                    remoto: n.copia.remoto.as_ref(),
                    ahora,
                    en_linea,
                    inactivo_seg: inactivo,
                    memoria: &n.copia.memoria,
                });
                aplicar(&app, &mut n, vista);
            }
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

// ------------------------------------------------------------------ actualizaciones

/// Busca versiones nuevas en los Releases de GitHub (firmadas) y las instala solo cuando nadie
/// está usando el equipo con una reserva. Solo en Windows (instalación por cuenta) y AppImage:
/// los .deb y .rpm pedirían la contraseña de administrador, así que esos los actualiza TI.
async fn actualizaciones(app: AppHandle, compartido: Compartido) {
    use tauri::utils::{config::BundleType, platform::bundle_type};
    use tauri_plugin_updater::UpdaterExt;
    let (Some(clave), Some(url)) = (option_env!("FARO_UPDATER_PUBKEY"), option_env!("FARO_UPDATER_URL")) else { return };
    if clave.is_empty() || url.is_empty() || !matches!(bundle_type(), Some(BundleType::Nsis) | Some(BundleType::AppImage)) {
        return;
    }
    let Ok(url) = url.parse::<tauri::Url>() else { return };
    tokio::time::sleep(Duration::from_secs(120)).await;
    loop {
        let actualizador = app.updater_builder().pubkey(clave).endpoints(vec![url.clone()]).and_then(|b| b.build());
        if let Ok(actualizador) = actualizador {
            if let Ok(Some(nueva)) = actualizador.check().await {
                // Espera un momento sin reserva vigente (máximo un día) para no interrumpir a nadie.
                for _ in 0..1440 {
                    let libre = compartido
                        .lock()
                        .unwrap()
                        .vista
                        .as_ref()
                        .map(|v| !matches!(v.estado, decision::Estado::Reservado | decision::Estado::PorTerminar | decision::Estado::Gracia))
                        .unwrap_or(true);
                    if libre {
                        break;
                    }
                    tokio::time::sleep(Duration::from_secs(60)).await;
                }
                let (cfg, token, carpeta) = {
                    let n = compartido.lock().unwrap();
                    (n.config.clone(), n.config.token.clone(), n.carpeta.clone())
                };
                if let Some(t) = &token {
                    let _ = Api::new().evento(&cfg, t, "actualizado", json!({ "de": env!("CARGO_PKG_VERSION"), "a": nueva.version })).await;
                }
                vigia::pausar(&carpeta, 600);
                if nueva.download_and_install(|_, _| {}, || {}).await.is_ok() {
                    app.restart();
                }
                vigia::quitar_pausa(&carpeta);
            }
        }
        tokio::time::sleep(Duration::from_secs(6 * 3600)).await;
    }
}

// ------------------------------------------------------------------ comandos

#[tauri::command]
fn estado_inicial(estado: tauri::State<Compartido>) -> Paquete {
    paquete(&estado.lock().unwrap())
}

#[tauri::command]
async fn vincular(app: AppHandle, estado: tauri::State<'_, Compartido>, codigo: String) -> Result<String, String> {
    let estado: Compartido = estado.inner().clone();
    let cfg = estado.lock().unwrap().config.clone();
    let (token, equipo) = Api::new().vincular(&cfg, codigo.trim(), &host(), &sistema()).await.map_err(|f| match f {
        Fallo::Mensaje(m) => m,
        Fallo::Red(_) => "No hay conexión con el servidor. Revise la red e intente de nuevo.".into(),
        Fallo::NoVinculado => "El código no es válido.".into(),
    })?;
    quedar_vinculado(&app, &estado, token, &equipo)?;
    Ok(equipo)
}

fn quedar_vinculado(app: &AppHandle, estado: &Compartido, token: String, equipo: &str) -> Result<(), String> {
    {
        let mut n = estado.lock().unwrap();
        config::guardar_vinculo(&n.carpeta, Some(&token), Some(equipo)).map_err(|e| format!("No se pudo guardar: {e}"))?;
        n.config.token = Some(token);
        n.config.equipo = Some(equipo.to_string());
        n.config.codigo_vinculo = None;
        n.copia = Copia::default();
        n.vista = None;
        n.forzar = true;
        n.pendientes.push(("inicio".into(), json!({ "motivo": "vinculado" })));
    }
    if let Some(i) = app.get_webview_window(ISLA) {
        let _ = i.show();
    }
    Ok(())
}

/// Vinculación sin teclear: el script de instalación deja el código en faro.json.
async fn vincular_solo(app: &AppHandle, api: &Api, compartido: &Compartido) -> bool {
    let (cfg, codigo) = {
        let n = compartido.lock().unwrap();
        (n.config.clone(), n.config.codigo_vinculo.clone())
    };
    let Some(codigo) = codigo else { return false };
    match api.vincular(&cfg, &codigo, &host(), &sistema()).await {
        Ok((token, equipo)) => {
            if quedar_vinculado(app, compartido, token, &equipo).is_ok() {
                if let Some(w) = app.get_webview_window(VINCULAR) {
                    let _ = w.destroy();
                }
            }
            false
        }
        // Código vencido o ya usado: se deja de intentar y queda la ventana para teclear otro.
        Err(Fallo::Mensaje(_)) | Err(Fallo::NoVinculado) => {
            compartido.lock().unwrap().config.codigo_vinculo = None;
            false
        }
        Err(Fallo::Red(_)) => true,
    }
}

#[tauri::command]
fn cerrar_vincular(app: AppHandle) {
    if let Some(w) = app.get_webview_window(VINCULAR) {
        let _ = w.destroy();
    }
}

#[tauri::command]
fn emergencia(estado: tauri::State<Compartido>, clave_ingresada: String) -> Result<(), String> {
    let mut n = estado.lock().unwrap();
    if let Some(h) = n.espera_hasta {
        if Instant::now() < h {
            return Err("Demasiados intentos. Espere un minuto.".into());
        }
    }
    let Some(c) = n.copia.remoto.as_ref().and_then(|r| r.clave.clone()) else {
        return Err("El laboratorio aún no ha creado una clave de emergencia.".into());
    };
    if clave::huella(&c.sal, &clave_ingresada, c.iteraciones) != c.hash {
        n.intentos_fallidos += 1;
        if n.intentos_fallidos >= 5 {
            n.intentos_fallidos = 0;
            n.espera_hasta = Some(Instant::now() + Duration::from_secs(60));
        }
        return Err("Clave incorrecta.".into());
    }
    n.intentos_fallidos = 0;
    let hasta = Utc::now() + Dur::milliseconds(n.copia.desfase_ms) + Dur::hours(EMERGENCIA_HORAS);
    n.copia.memoria.emergencia_hasta = Some(hasta);
    n.pendientes.push(("desbloqueo_emergencia".into(), json!({ "horas": EMERGENCIA_HORAS.to_string() })));
    n.forzar = true;
    config::guardar_copia(&n.carpeta, &n.copia);
    Ok(())
}

#[tauri::command]
fn abrir(app: AppHandle, estado: tauri::State<Compartido>, ruta: String) -> Result<(), String> {
    let url = estado.lock().unwrap().config.url_pwa(&ruta).ok_or("Falta la dirección de LADME en la configuración de Faro.")?;
    abrir_url(&app, &url).map_err(|e| format!("No se pudo abrir el navegador: {e}"))
}

/// En Linux se llama a xdg-open con un entorno limpio: dentro de un AppImage (y con el modo
/// XWayland de Faro) las variables propias de Faro hacían que el navegador no abriera.
#[cfg(target_os = "linux")]
fn abrir_url(_app: &AppHandle, url: &str) -> Result<(), String> {
    let mut c = std::process::Command::new("xdg-open");
    c.arg(url);
    for v in ["LD_LIBRARY_PATH", "LD_PRELOAD", "GDK_BACKEND", "GDK_PIXBUF_MODULE_FILE", "GIO_MODULE_DIR", "GTK_PATH",
              "GTK_EXE_PREFIX", "GTK_DATA_PREFIX", "GSETTINGS_SCHEMA_DIR", "PYTHONHOME", "PYTHONPATH", "PERLLIB",
              "QT_PLUGIN_PATH", "APPDIR", "APPIMAGE", "ARGV0", "OWD"] {
        c.env_remove(v);
    }
    // XDG_DATA_DIRS del AppImage apunta a su carpeta interna; se vuelve al valor normal del sistema.
    c.env("XDG_DATA_DIRS", "/usr/local/share:/usr/share");
    c.spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(not(target_os = "linux"))]
fn abrir_url(app: &AppHandle, url: &str) -> Result<(), String> {
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn qr(estado: tauri::State<Compartido>, ruta: String) -> Option<String> {
    estado.lock().unwrap().config.url_pwa(&ruta).as_deref().and_then(qr_svg)
}

#[tauri::command]
fn isla_tamano(app: AppHandle, ancho: f64, alto: f64) {
    if let Some(w) = app.get_webview_window(ISLA) {
        let _ = w.set_size(tauri::LogicalSize::new(ancho.clamp(200.0, 640.0), alto.clamp(40.0, 520.0)));
        centrar_isla(&w);
    }
}

#[tauri::command]
fn actualizar_ya(estado: tauri::State<Compartido>) {
    estado.lock().unwrap().forzar = true;
}

// ------------------------------------------------------------------ arranque

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window(VINCULAR) {
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .setup(|app| {
            let carpeta = app.path().app_config_dir()?;
            vigia::escribir_pid(&carpeta, "faro.pid");
            vigia::quitar_pausa(&carpeta);
            let reabierto = std::env::args().any(|a| a == vigia::REABIERTO);
            let config = config::cargar(&carpeta);
            let copia = config::cargar_copia(&carpeta);
            let vinculado = config.token.is_some();
            let compartido: Compartido = Arc::new(Mutex::new(Nucleo {
                carpeta,
                config,
                copia,
                ultimo_ok: None,
                vista: None,
                pendientes: vec![if reabierto {
                    ("cierre_forzado".into(), json!({ "detalle": "Faro se cerró a la fuerza y el vigía lo volvió a abrir" }))
                } else {
                    ("inicio".into(), json!({ "motivo": "arranque" }))
                }],
                forzar: true,
                intentos_fallidos: 0,
                espera_hasta: None,
            }));
            app.manage(compartido.clone());

            // Arranca solo al iniciar sesión en esta cuenta (no requiere permisos de administrador).
            // Si lo abre un servicio de systemd (script de Linux), el arranque y el reinicio son de
            // systemd: se quita la entrada de inicio propia para no abrir dos veces.
            #[cfg(not(debug_assertions))]
            {
                use tauri_plugin_autostart::ManagerExt;
                if gestionado_por_systemd() {
                    let _ = app.autolaunch().disable();
                } else {
                    let _ = app.autolaunch().enable();
                }
            }

            let isla = crear_isla(app.handle())?;
            if vinculado {
                let _ = isla.show();
            } else {
                abrir_vincular(app.handle());
            }
            tauri::async_runtime::spawn(ciclo(app.handle().clone(), compartido.clone()));
            tauri::async_runtime::spawn(actualizaciones(app.handle().clone(), compartido));
            Ok(())
        })
        .on_window_event(|w, ev| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = ev {
                let etiqueta = w.label();
                if etiqueta == ISLA || etiqueta.starts_with(PREFIJO_BLOQUEO) {
                    api.prevent_close();
                    if etiqueta.starts_with(PREFIJO_BLOQUEO) {
                        if let Some(c) = w.app_handle().try_state::<Compartido>() {
                            c.lock().unwrap().pendientes.push(("cierre_intentado".into(), json!({})));
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            estado_inicial,
            vincular,
            cerrar_vincular,
            emergencia,
            abrir,
            qr,
            isla_tamano,
            actualizar_ya
        ])
        .build(tauri::generate_context!())
        .expect("no se pudo iniciar Faro")
        .run(|app, ev| {
            // Cerrar la ventana de vinculación no apaga Faro si el equipo ya está vinculado.
            if let tauri::RunEvent::ExitRequested { code: None, api, .. } = ev {
                let vinculado = app
                    .try_state::<Compartido>()
                    .map(|c| c.lock().unwrap().config.token.is_some())
                    .unwrap_or(false);
                if vinculado {
                    api.prevent_exit();
                }
            }
        });
}
