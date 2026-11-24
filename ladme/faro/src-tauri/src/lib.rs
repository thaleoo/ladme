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
mod inventario;
mod isla;
mod ordenes;
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
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const ISLA: &str = isla::ETIQUETA;
const VINCULAR: &str = "vincular";
const PREFIJO_BLOQUEO: &str = "bloqueo-";
/// Cuánto dura un desbloqueo con la clave de emergencia.
const EMERGENCIA_HORAS: i64 = 2;
/// Cada cuánto se vuelve a medir el equipo y a leer los programas instalados.
const INVENTARIO_CADA_SEG: u64 = 3600;

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
    /// Aviso propio de Faro (p. ej. «se apagará en 1 minuto») hasta un momento.
    aviso_local: Option<(String, Instant)>,
    /// Inventario recolectado que falta enviar en el próximo latido.
    inventario_pendiente: Option<Value>,
    /// El panel pidió «Actualizar datos»: el inventario se recolecta en la próxima vuelta.
    inventario_ya: bool,
}

/// Despierta al ciclo de actualizaciones cuando el panel ordena «Actualizar ahora».
struct ActualizarYa(Arc<tokio::sync::Notify>);

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
    /// Dirección de la PWA, para mostrar el enlace corto (…/e/UNAL-05).
    url_base: Option<String>,
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
        url_base: n.config.url_pwa(""),
    }
}

// ------------------------------------------------------------------ ventanas

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
fn aplicar(app: &AppHandle, n: &mut Nucleo, mut nueva: Vista) {
    if let Some((texto, hasta)) = &n.aviso_local {
        if Instant::now() < *hasta {
            nueva.anuncio = Some(texto.clone());
        }
    }
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

async fn latir(app: &AppHandle, api: &Api, compartido: &Compartido, inactivo: Option<u64>, cpu: u32, programas: Vec<String>) {
    let (cfg, token, bloqueado, inventario) = {
        let n = compartido.lock().unwrap();
        (n.config.clone(), n.config.token.clone(), n.copia.bloqueado, n.inventario_pendiente.clone())
    };
    let Some(token) = token else { return };
    let mut info = json!({ "inactivo_seg": inactivo, "bloqueado": bloqueado, "host": host(), "so": sistema(),
                           "version": env!("CARGO_PKG_VERSION"), "cpu": cpu, "programas": programas });
    if let Some(inv) = inventario {
        info["inventario"] = inv;
    }
    match api.estado(&cfg, &token, info).await {
        Ok(mut r) => {
            let comandos = std::mem::take(&mut r.comandos);
            compartido.lock().unwrap().inventario_pendiente = None;
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
            for c in comandos {
                ejecutar_orden(app, api, compartido, &cfg, &token, c).await;
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

/// Ejecuta una orden del panel e informa el resultado.
async fn ejecutar_orden(app: &AppHandle, api: &Api, compartido: &Compartido, cfg: &Config, token: &str, c: decision::Comando) {
    let carpeta = compartido.lock().unwrap().carpeta.clone();
    let resultado: Result<String, String> = match c.tipo.as_str() {
        "reiniciar" => Ok("reiniciando".into()),
        "actualizar" => {
            if let Some(a) = app.try_state::<ActualizarYa>() {
                a.0.notify_one();
            }
            Ok("buscando actualización".into())
        }
        // Nunca se apaga un equipo con un proceso compartido en curso (el servidor también lo evita).
        "apagar" if compartido.lock().unwrap().copia.remoto.as_ref().and_then(|r| r.compartido.as_ref()).is_some_and(|c| c.hasta > Utc::now()) => {
            Err("hay un uso compartido en curso: no se apaga".into())
        }
        "apagar" => ordenes::apagar().map(|_| {
            compartido.lock().unwrap().aviso_local = Some((
                "El laboratorio apagará este equipo en 1 minuto. Guarda tu trabajo.".into(),
                Instant::now() + Duration::from_secs(60),
            ));
            "se apaga en 1 minuto".into()
        }),
        "despertar" => {
            let macs: Vec<String> = c.datos["macs"].as_array().map(|l| l.iter().filter_map(|m| m.as_str().map(String::from)).collect()).unwrap_or_default();
            ordenes::despertar(&macs).map(|n| format!("paquete enviado a {n} equipos"))
        }
        "desinstalar" => ordenes::se_puede_retirar().map(|_| "retirándose".into()),
        "inventario" => {
            let mut n = compartido.lock().unwrap();
            n.inventario_ya = true;
            n.forzar = true;
            Ok("leyendo el equipo y sus programas".into())
        }
        otro => Err(format!("orden desconocida: {otro}")),
    };
    let (ok, texto) = match &resultado {
        Ok(t) => (true, t.clone()),
        Err(e) => (false, e.clone()),
    };
    let _ = api.resultado(cfg, token, c.id, ok, &texto).await;
    if !ok {
        return;
    }
    match c.tipo.as_str() {
        "reiniciar" => {
            vigia::pausar(&carpeta, 30);
            app.restart();
        }
        "desinstalar" => {
            let _ = ordenes::retirar(app, &carpeta);
        }
        _ => {}
    }
}

async fn ciclo(app: AppHandle, compartido: Compartido) {
    let api = Api::new();
    let mut medidor = inventario::Medidor::new();
    let mut lector = inventario::Programas::new();
    // El inventario (salud del disco, memoria, programas instalados) se recolecta al minuto de
    // arrancar, luego cada hora y cuando el panel pide «Actualizar datos».
    let mut proximo_inventario = Instant::now() + Duration::from_secs(60);
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
        let pedido = std::mem::take(&mut compartido.lock().unwrap().inventario_ya);
        if vinculado && (pedido || Instant::now() >= proximo_inventario) {
            proximo_inventario = Instant::now() + Duration::from_secs(INVENTARIO_CADA_SEG);
            let c = compartido.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let inv = inventario::recolectar();
                c.lock().unwrap().inventario_pendiente = Some(inv);
            });
        }
        if vinculado && toca {
            ultimo_latido = Some(Instant::now());
            let cpu = medidor.cpu_pct();
            let programas = lector.activos();
            latir(&app, &api, &compartido, inactivo, cpu, programas).await;
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
    let estable = url.to_string();
    // Canal de pruebas: el manifiesto vive en la release fija «faro-pruebas».
    let pruebas = estable.replace("/releases/latest/download/latest.json", "/releases/download/faro-pruebas/latest.json");
    let despertador = app.state::<ActualizarYa>().0.clone();
    tokio::select! {
        _ = tokio::time::sleep(Duration::from_secs(120)) => {}
        _ = despertador.notified() => {}
    }
    loop {
        let canal = compartido.lock().unwrap().copia.remoto.as_ref().and_then(|r| r.canal.clone()).unwrap_or_default();
        let Ok(url) = (if canal == "pruebas" { &pruebas } else { &estable }).parse::<tauri::Url>() else { return };
        let actualizador = app.updater_builder().pubkey(clave).endpoints(vec![url]).and_then(|b| b.build());
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
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(6 * 3600)) => {}
            _ = despertador.notified() => {}
        }
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

/// Verifica la clave de emergencia, con pausa de un minuto tras 5 intentos fallidos.
fn verificar_clave(n: &mut Nucleo, clave_ingresada: &str) -> Result<(), String> {
    if let Some(h) = n.espera_hasta {
        if Instant::now() < h {
            return Err("Demasiados intentos. Espere un minuto.".into());
        }
    }
    let Some(c) = n.copia.remoto.as_ref().and_then(|r| r.clave.clone()) else {
        return Err("El laboratorio aún no ha creado una clave de emergencia.".into());
    };
    if clave::huella(&c.sal, clave_ingresada, c.iteraciones) != c.hash {
        n.intentos_fallidos += 1;
        if n.intentos_fallidos >= 5 {
            n.intentos_fallidos = 0;
            n.espera_hasta = Some(Instant::now() + Duration::from_secs(60));
        }
        return Err("Clave incorrecta.".into());
    }
    n.intentos_fallidos = 0;
    Ok(())
}

#[tauri::command]
fn emergencia(estado: tauri::State<Compartido>, clave_ingresada: String) -> Result<(), String> {
    let mut n = estado.lock().unwrap();
    verificar_clave(&mut n, &clave_ingresada)?;
    let hasta = Utc::now() + Dur::milliseconds(n.copia.desfase_ms) + Dur::hours(EMERGENCIA_HORAS);
    n.copia.memoria.emergencia_hasta = Some(hasta);
    n.pendientes.push(("desbloqueo_emergencia".into(), json!({ "horas": EMERGENCIA_HORAS.to_string() })));
    n.forzar = true;
    config::guardar_copia(&n.carpeta, &n.copia);
    Ok(())
}

#[derive(Serialize)]
struct QrLlegada {
    svg: String,
    /// Código de 6 dígitos que la persona escribe en «Confirmar asistencia».
    numero: String,
    /// Segundos hasta que cambia el código.
    cambia_en: i64,
}

/// Código para confirmar la asistencia: 6 dígitos que cambian cada 30 s y un QR que abre
/// «Confirmar asistencia» con el código ya puesto. Solo sirve a quien tiene la reserva de este
/// equipo (lo verifica el servidor).
#[tauri::command]
fn qr_llegada(estado: tauri::State<Compartido>) -> Option<QrLlegada> {
    let n = estado.lock().unwrap();
    let r = n.copia.remoto.as_ref()?;
    let secreto = &r.qr.as_ref()?.secreto;
    let ahora = (Utc::now() + Dur::milliseconds(n.copia.desfase_ms)).timestamp();
    let numero = ordenes::codigo_numero(secreto, &r.equipo.codigo, ahora.div_euclid(30));
    let url = n.config.url_pwa(&format!("/llegada?c={numero}"))?;
    Some(QrLlegada { svg: qr_svg(&url)?, numero, cambia_en: 30 - ahora.rem_euclid(30) })
}

/// La isla no toma el foco al aparecer; lo pide cuando hay que escribir (clave del personal).
#[tauri::command]
fn isla_foco(app: AppHandle) {
    if let Some(w) = app.get_webview_window(ISLA) {
        let _ = w.set_focus();
    }
}

/// Borra los archivos que dejó la sesión que acaba de terminar (Descargas y Escritorio).
#[tauri::command]
fn limpiar_sesion(estado: tauri::State<Compartido>) -> Result<usize, String> {
    let desde = estado.lock().unwrap().vista.as_ref().and_then(|v| v.limpieza_desde).ok_or("No hay una sesión reciente para limpiar.")?;
    let n = ordenes::limpiar(desde)?;
    let mut nucleo = estado.lock().unwrap();
    nucleo.copia.memoria.inicio_reciente = None;
    config::guardar_copia(&nucleo.carpeta, &nucleo.copia);
    Ok(n)
}

/// Retira Faro de este PC con la clave de emergencia del laboratorio (sin internet también).
#[tauri::command]
async fn retirar(app: AppHandle, estado: tauri::State<'_, Compartido>, clave_ingresada: String) -> Result<(), String> {
    let (carpeta, cfg, token) = {
        let mut n = estado.lock().unwrap();
        verificar_clave(&mut n, &clave_ingresada)?;
        (n.carpeta.clone(), n.config.clone(), n.config.token.clone())
    };
    ordenes::se_puede_retirar()?;
    if let Some(t) = token {
        let _ = Api::new().evento(&cfg, &t, "retirado", json!({ "por": "clave de emergencia" })).await;
    }
    ordenes::retirar(&app, &carpeta)
}

#[tauri::command]
fn qr(estado: tauri::State<Compartido>, ruta: String) -> Option<String> {
    estado.lock().unwrap().config.url_pwa(&ruta).as_deref().and_then(qr_svg)
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
                aviso_local: None,
                inventario_pendiente: None,
                inventario_ya: false,
            }));
            app.manage(ActualizarYa(Arc::new(tokio::sync::Notify::new())));
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

            app.manage(isla::iniciar(&compartido.lock().unwrap().carpeta));
            let isla = isla::crear(app.handle())?;
            if vinculado {
                let _ = isla.show();
            } else {
                abrir_vincular(app.handle());
            }
            tauri::async_runtime::spawn(ciclo(app.handle().clone(), compartido.clone()));
            tauri::async_runtime::spawn(actualizaciones(app.handle().clone(), compartido));
            tauri::async_runtime::spawn(isla::vigilar_cursor(app.handle().clone(), app.state::<isla::Compartida>().inner().clone()));
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
            qr,
            qr_llegada,
            isla_foco,
            limpiar_sesion,
            retirar,
            isla::isla_zona,
            isla::isla_arrastre,
            isla::isla_posicion,
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
