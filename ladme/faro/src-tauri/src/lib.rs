//! Faro: la isla de LADME en cada PC de la sala.
//!
//! - Cada 30 s (10 s mientras está bloqueado) pregunta a Supabase qué pasa con su equipo.
//! - Cada segundo decide qué mostrar (`decision::decidir`) con la última respuesta.
//! - Muestra la isla arriba de la pantalla y, en modo bloquear, una pantalla de bloqueo
//!   en cada monitor. Nunca cierra la sesión ni detiene programas: solo cubre la pantalla.

mod api;
mod clave;
mod cli;
mod config;
mod decision;
mod diag;
mod inactividad;
mod inventario;
mod isla;
mod ordenes;
mod registro;
#[cfg(unix)]
mod remoto;
#[cfg(unix)]
mod servicio;
mod vigia;

pub use vigia::ARG as ARG_VIGIA;

/// `ladme-faro --servicio`: lo arranca systemd como root (ver servicio.rs).
#[cfg(unix)]
pub fn correr_servicio() {
    servicio::correr()
}

/// ¿El primer argumento es un comando de la línea de comandos (`faro doctor`…)?
pub fn es_comando_cli(a: &str) -> bool {
    cli::es_comando(a)
}

/// Ejecuta la línea de comandos y devuelve el código de salida (ver `cli.rs`).
pub fn ejecutar_cli(args: &[String]) -> i32 {
    cli::ejecutar(args)
}

/// Punto de entrada del vigía (ver `vigia.rs`).
pub fn correr_vigia(carpeta: PathBuf) {
    vigia::correr(carpeta)
}

use api::{Api, Fallo};
use chrono::{Duration as Dur, Utc};
use config::{Config, Copia};
use decision::{Entrada, Pantalla, Vista};
use serde::{Deserialize, Serialize};
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
    /// Acciones hechas en la pantalla sin respuesta del servidor (reanudar, anuncio leído); se envían en el
    /// próximo latido. Solo en memoria: pueden llevar un código y no se escriben en disco.
    acciones: Vec<(String, Value)>,
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
    /// Dirección de la PWA, para mostrar el enlace corto (…/e/UNAL-05).
    url_base: Option<String>,
    /// El equipo tiene tarjeta NFC en la base del monitor (0025).
    nfc: bool,
    /// Segundos sin hablar con el servidor (solo si se perdió la conexión).
    sin_red_seg: Option<i64>,
}

/// Lo que el núcleo de Faro (el ciclo con el servidor) le pide a la interfaz. Con Faro por cuenta, el
/// núcleo y la interfaz viven en el mismo proceso; con el servicio del sistema, el núcleo vive en el
/// servicio y esto viaja por el socket a la interfaz de cada sesión.
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(tag = "senal", content = "datos", rename_all = "snake_case")]
pub(crate) enum Senal {
    Paquete(Value),
    Vinculado,
    Desvinculado,
    Reiniciar,
    Detener,
    Retirar,
}

pub(crate) type Salida = Arc<dyn Fn(Senal) + Send + Sync>;

/// Contexto del núcleo: a quién avisar y cómo despertar el ciclo de actualizaciones.
#[derive(Clone)]
pub(crate) struct Ctx {
    salida: Salida,
    actualizar: Arc<tokio::sync::Notify>,
    /// El núcleo corre en el servicio del sistema (no en la cuenta).
    servicio: bool,
}

impl Ctx {
    fn avisar(&self, s: Senal) {
        (self.salida)(s)
    }
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
        nfc: n.copia.remoto.as_ref().map(|r| r.nfc).unwrap_or(false),
        sin_red_seg: sin_red_seg(n),
    }
}

/// Hace cuánto no hay contacto con el servidor, o nada si la conexión está bien.
fn sin_red_seg(n: &Nucleo) -> Option<i64> {
    if n.config.token.is_none() || n.ultimo_ok.map(|t| t.elapsed() < Duration::from_secs(90)).unwrap_or(false) {
        return None;
    }
    Some(n.copia.recibido_en.map(|d| (Utc::now() - d).num_seconds().max(0)).unwrap_or(0))
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
fn aplicar(ctx: &Ctx, n: &mut Nucleo, mut nueva: Vista) {
    if let Some((texto, hasta)) = &n.aviso_local {
        if Instant::now() < *hasta {
            nueva.anuncio = Some(texto.clone());
        }
    }
    let antes = n.vista.as_ref().map(|v| v.pantalla.clone());
    if antes.as_ref() != Some(&nueva.pantalla) {
        match (antes, &nueva.pantalla) {
            (_, Pantalla::Bloqueo) => n.pendientes.push(("bloqueo".into(), json!({ "estado": format!("{:?}", nueva.estado) }))),
            (_, Pantalla::Suspension) => registro::info("Pantalla suspendida"),
            (Some(Pantalla::Suspension), _) => registro::info("Suspensión quitada"),
            (Some(Pantalla::Bloqueo), _) => n.pendientes.push(("desbloqueo".into(), json!({}))),
            _ => {}
        }
    }
    n.copia.bloqueado = matches!(nueva.pantalla, Pantalla::Bloqueo | Pantalla::Suspension);
    let cambio = n.vista.as_ref() != Some(&nueva);
    n.vista = Some(nueva);
    if cambio {
        ctx.avisar(Senal::Paquete(serde_json::to_value(paquete(n)).unwrap_or(Value::Null)));
    }
}

/// Estado de la interfaz: la última pantalla mostrada y el último paquete (para quien abre después).
#[derive(Default)]
pub(crate) struct Interfaz {
    pantalla: Mutex<Option<String>>,
    ultimo: Mutex<Option<Value>>,
}

fn cubre(pantalla: Option<&str>) -> bool {
    pantalla.is_some_and(|p| p != "ninguna")
}

/// La interfaz atiende lo que pide el núcleo: muestra u oculta la isla y las pantallas de bloqueo.
pub(crate) fn atender(app: &AppHandle, s: Senal) {
    match s {
        Senal::Paquete(p) => {
            let estado = app.state::<Interfaz>();
            let nueva = p["vista"]["pantalla"].as_str().map(String::from);
            let vinculado = p["vinculado"].as_bool().unwrap_or(false);
            let antes = estado.pantalla.lock().unwrap().replace(nueva.clone().unwrap_or_else(|| "ninguna".into()));
            if antes.as_deref() != Some(nueva.as_deref().unwrap_or("ninguna")) {
                if cubre(nueva.as_deref()) {
                    mostrar_bloqueo(app);
                    if let Some(i) = app.get_webview_window(ISLA) {
                        let _ = i.hide();
                    }
                } else {
                    quitar_bloqueo(app);
                    if let Some(i) = app.get_webview_window(ISLA) {
                        let _ = if vinculado { i.show() } else { i.hide() };
                    }
                }
            }
            *estado.ultimo.lock().unwrap() = Some(p.clone());
            let _ = app.emit("faro://vista", p);
        }
        Senal::Vinculado => {
            if let Some(i) = app.get_webview_window(ISLA) {
                let _ = i.show();
            }
            if let Some(w) = app.get_webview_window(VINCULAR) {
                let _ = w.destroy();
            }
        }
        Senal::Desvinculado => {
            quitar_bloqueo(app);
            *app.state::<Interfaz>().pantalla.lock().unwrap() = None;
            if let Some(i) = app.get_webview_window(ISLA) {
                let _ = i.hide();
            }
            abrir_vincular(app);
        }
        Senal::Reiniciar => app.restart(),
        Senal::Detener => {
            // Con el servicio del sistema, la interfaz se queda esperando a que vuelva.
            #[cfg(unix)]
            if app.try_state::<remoto::Remoto>().is_some() {
                return;
            }
            app.exit(0)
        }
        Senal::Retirar => {
            let carpeta = app.path().app_config_dir().unwrap_or_default();
            let _ = ordenes::retirar(app, &carpeta);
        }
    }
}

/// Sin servicio al que conectarse (modo servicio, conexión perdida): no se muestra nada.
#[cfg(unix)]
pub(crate) fn sin_nucleo(app: &AppHandle) {
    quitar_bloqueo(app);
    *app.state::<Interfaz>().pantalla.lock().unwrap() = None;
    if let Some(i) = app.get_webview_window(ISLA) {
        let _ = i.hide();
    }
}

/// Que la pantalla de bloqueo no quede detrás de otra ventana (cada segundo).
async fn mantener_bloqueo_encima(app: AppHandle) {
    loop {
        tokio::time::sleep(Duration::from_secs(1)).await;
        let tapa = cubre(app.state::<Interfaz>().pantalla.lock().unwrap().as_deref());
        if tapa {
            if let Some(w) = ventanas_bloqueo(&app).into_iter().find(|w| w.label() == format!("{PREFIJO_BLOQUEO}0")) {
                if !w.is_focused().unwrap_or(true) {
                    let _ = w.set_always_on_top(true);
                    let _ = w.set_focus();
                }
            }
        }
    }
}

// ------------------------------------------------------------------ ciclo

async fn latir(ctx: &Ctx, api: &Api, compartido: &Compartido, inactivo: Option<u64>, cpu: u32, programas: Vec<String>) {
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
            let acciones = std::mem::take(&mut compartido.lock().unwrap().acciones);
            for (i, (accion, datos)) in acciones.iter().enumerate() {
                match api.accion(&cfg, &token, accion, datos.clone()).await {
                    Ok(_) => registro::info(format!("El servidor recibió «{accion}»")),
                    Err(Fallo::Red(_)) => {
                        compartido.lock().unwrap().acciones.extend(acciones[i..].iter().cloned());
                        break;
                    }
                    Err(Fallo::Mensaje(m)) => registro::aviso(format!("El servidor no aceptó «{accion}»: {m}")),
                    Err(Fallo::NoVinculado) => break,
                }
            }
            for c in comandos {
                ejecutar_orden(ctx, api, compartido, &cfg, &token, c).await;
            }
        }
        Err(Fallo::NoVinculado) => {
            registro::aviso("El servidor ya no reconoce este equipo: queda desvinculado");
            let mut n = compartido.lock().unwrap();
            quedar_desvinculado(ctx, &mut n);
        }
        Err(Fallo::Red(e)) => registro::aviso(format!("Sin conexión con el servidor ({e})")),
        Err(Fallo::Mensaje(m)) => registro::error(format!("El servidor respondió: {m}")),
    }
}

/// Quita el vínculo de este equipo y deja la ventana para vincularlo de nuevo.
fn quedar_desvinculado(ctx: &Ctx, n: &mut Nucleo) {
    n.config.token = None;
    n.config.equipo = None;
    n.copia = Copia::default();
    n.vista = None;
    let _ = config::guardar_vinculo(&n.carpeta, None, None);
    config::guardar_copia(&n.carpeta, &n.copia);
    ctx.avisar(Senal::Desvinculado);
    ctx.avisar(Senal::Paquete(serde_json::to_value(paquete(n)).unwrap_or(Value::Null)));
}

/// Ejecuta una orden del panel e informa el resultado.
async fn ejecutar_orden(ctx: &Ctx, api: &Api, compartido: &Compartido, cfg: &Config, token: &str, c: decision::Comando) {
    let carpeta = compartido.lock().unwrap().carpeta.clone();
    let resultado: Result<String, String> = match c.tipo.as_str() {
        "reiniciar" => Ok("reiniciando".into()),
        "actualizar" => {
            ctx.actualizar.notify_one();
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
        "desinstalar" if ctx.servicio => Err("con el servicio del sistema lo retira TI: sudo bash desinstalar-linux.sh".into()),
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
    if ok {
        registro::info(format!("Orden del panel «{}»: {texto}", c.tipo));
    } else {
        registro::aviso(format!("Orden del panel «{}» no se cumplió: {texto}", c.tipo));
    }
    if !ok {
        return;
    }
    match c.tipo.as_str() {
        "reiniciar" => {
            vigia::pausar(&carpeta, 30);
            ctx.avisar(Senal::Reiniciar);
        }
        "desinstalar" => ctx.avisar(Senal::Retirar),
        _ => {}
    }
}

pub(crate) type Inactividad = Arc<dyn Fn() -> Option<u64> + Send + Sync>;

async fn ciclo(ctx: Ctx, compartido: Compartido, inactividad: Inactividad) {
    let api = Api::new();
    let mut medidor = inventario::Medidor::new();
    let mut lector = inventario::Programas::new();
    // El inventario (salud del disco, memoria, programas instalados) se recolecta al minuto de
    // arrancar, luego cada hora y cuando el panel pide «Actualizar datos».
    let mut proximo_inventario = Instant::now() + Duration::from_secs(60);
    let mut ultimo_latido: Option<Instant> = None;
    let mut ultimo_intento_vinculo: Option<Instant> = None;
    let mut ultima_revision_vigia = Instant::now();
    let mut estaba_en_linea: Option<bool> = None;
    loop {
        if !ctx.servicio && revisar_orden_cli(&ctx, &compartido) {
            ultimo_intento_vinculo = None; // `faro link`: se intenta ya
        }
        let inactivo = inactividad();
        let (vinculado, carpeta, forzado) = {
            let n = compartido.lock().unwrap();
            (n.config.token.is_some(), n.carpeta.clone(), n.forzar)
        };
        // `faro link` por el socket del servicio deja `forzar`: se intenta ya.
        if !vinculado && (forzado || ultimo_intento_vinculo.map(|t| t.elapsed() > Duration::from_secs(30)).unwrap_or(true)) {
            ultimo_intento_vinculo = Some(Instant::now());
            vincular_solo(&ctx, &api, &compartido).await;
        }
        // El vigía solo acompaña a un Faro vinculado y en la versión instalada.
        if vinculado && !ctx.servicio && cfg!(not(debug_assertions)) && !gestionado_por_systemd() && ultima_revision_vigia.elapsed() >= Duration::from_secs(3) {
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
            tokio::task::spawn_blocking(move || {
                let inv = inventario::recolectar();
                c.lock().unwrap().inventario_pendiente = Some(inv);
            });
        }
        if vinculado && toca {
            ultimo_latido = Some(Instant::now());
            let cpu = medidor.cpu_pct();
            let programas = lector.activos();
            latir(&ctx, &api, &compartido, inactivo, cpu, programas).await;
        }
        {
            let mut n = compartido.lock().unwrap();
            if n.config.token.is_some() {
                let ahora = Utc::now() + Dur::milliseconds(n.copia.desfase_ms);
                let en_linea = n.ultimo_ok.map(|t| t.elapsed() < Duration::from_secs(90)).unwrap_or(false);
                if estaba_en_linea != Some(en_linea) {
                    if en_linea {
                        registro::info("Conectado con el servidor");
                    } else if estaba_en_linea.is_some() {
                        registro::aviso("Se perdió la conexión con el servidor: Faro sigue con la última información");
                    }
                    estaba_en_linea = Some(en_linea);
                }
                let vista = decision::decidir(&Entrada {
                    remoto: n.copia.remoto.as_ref(),
                    ahora,
                    en_linea,
                    inactivo_seg: inactivo,
                    memoria: &n.copia.memoria,
                });
                aplicar(&ctx, &mut n, vista);
            }
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

// ------------------------------------------------------------------ actualizaciones

/// Busca versiones nuevas en los Releases de GitHub (firmadas) y las instala solo cuando nadie
/// está usando el equipo con una reserva. Solo en Windows (instalación por cuenta) y AppImage:
/// los .deb y .rpm pedirían la contraseña de administrador, así que esos los actualiza TI.
async fn actualizaciones(app: AppHandle, compartido: Compartido, despertador: Arc<tokio::sync::Notify>) {
    use tauri::utils::{config::BundleType, platform::bundle_type};
    use tauri_plugin_updater::UpdaterExt;
    let (Some(clave), Some(url)) = (option_env!("FARO_UPDATER_PUBKEY"), option_env!("FARO_UPDATER_URL")) else { return };
    if clave.is_empty() || url.is_empty() || !matches!(bundle_type(), Some(BundleType::Nsis) | Some(BundleType::AppImage)) {
        return;
    }
    let estable = url.to_string();
    // Canal de pruebas: el manifiesto vive en la release fija «faro-pruebas».
    let pruebas = estable.replace("/releases/latest/download/latest.json", "/releases/download/faro-pruebas/latest.json");
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
                registro::info(format!("Instalando la versión {}", nueva.version));
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
//
// Cada acción de la interfaz es una función del núcleo (`c_*`) que devuelve JSON. Con Faro por cuenta,
// el comando de Tauri la llama directo; con el servicio del sistema, la pide por el socket.

/// El núcleo local (Faro por cuenta). `None` cuando la interfaz habla con el servicio.
fn local(app: &AppHandle) -> Option<(Ctx, Compartido)> {
    Some((app.try_state::<Ctx>()?.inner().clone(), app.try_state::<Compartido>()?.inner().clone()))
}

/// Llama a una acción: en el núcleo local o en el servicio.
async fn pedir(app: &AppHandle, nombre: &str, args: Value) -> Result<Value, String> {
    #[cfg(unix)]
    if let Some(r) = app.try_state::<remoto::Remoto>() {
        return r.llamar(nombre, args).await;
    }
    let (ctx, c) = local(app).ok_or("Faro aún no está listo.")?;
    despachar(&ctx, &c, nombre, args).await
}

/// Las acciones que la interfaz (o la línea de comandos, por el socket) puede pedirle al núcleo.
pub(crate) async fn despachar(ctx: &Ctx, c: &Compartido, nombre: &str, a: Value) -> Result<Value, String> {
    let texto = |k: &str| a[k].as_str().unwrap_or("").to_string();
    match nombre {
        "paquete" => Ok(serde_json::to_value(paquete(&c.lock().unwrap())).unwrap_or(Value::Null)),
        "vincular" => c_vincular(ctx, c, &texto("codigo")).await.map(Value::from),
        "emergencia" => c_emergencia(c, &texto("clave")).map(|_| Value::Null),
        "quitar_suspension" => c_quitar_suspension(c, &texto("codigo")).map(Value::from),
        "confirmar_anuncio" => {
            c_confirmar_anuncio(c, a["id"].as_i64().unwrap_or(0));
            Ok(Value::Null)
        }
        "qr_llegada" => Ok(c_qr_llegada(c).map(|q| serde_json::to_value(q).unwrap_or(Value::Null)).unwrap_or(Value::Null)),
        "limpieza_hecha" => {
            let mut n = c.lock().unwrap();
            n.copia.memoria.inicio_reciente = None;
            config::guardar_copia(&n.carpeta, &n.copia);
            Ok(Value::Null)
        }
        "retirar" => c_retirar(ctx, c, &texto("clave")).await.map(|_| Value::Null),
        "actualizar_ya" => {
            c.lock().unwrap().forzar = true;
            Ok(Value::Null)
        }
        "accion_isla" => c_accion_isla(c, &a).await.map(Value::from),
        "evento" => {
            let tipo = texto("tipo");
            if tipo == "cierre_intentado" {
                c.lock().unwrap().pendientes.push((tipo, json!({})));
            }
            Ok(Value::Null)
        }
        otro => Err(format!("Acción desconocida: {otro}")),
    }
}

#[tauri::command]
fn estado_inicial(app: AppHandle) -> Value {
    if let Some((_, c)) = local(&app) {
        return serde_json::to_value(paquete(&c.lock().unwrap())).unwrap_or(Value::Null);
    }
    app.state::<Interfaz>().ultimo.lock().unwrap().clone().unwrap_or(Value::Null)
}

#[tauri::command]
async fn vincular(app: AppHandle, codigo: String) -> Result<Value, String> {
    pedir(&app, "vincular", json!({ "codigo": codigo })).await
}

async fn c_vincular(ctx: &Ctx, estado: &Compartido, codigo: &str) -> Result<String, String> {
    let cfg = estado.lock().unwrap().config.clone();
    let (token, equipo) = Api::new().vincular(&cfg, codigo.trim(), &host(), &sistema()).await.map_err(|f| match f {
        Fallo::Mensaje(m) => m,
        Fallo::Red(_) => "No hay conexión con el servidor. Revise la red e intente de nuevo.".into(),
        Fallo::NoVinculado => "El código no es válido.".into(),
    })?;
    quedar_vinculado(ctx, estado, token, &equipo)?;
    Ok(equipo)
}

fn quedar_vinculado(ctx: &Ctx, estado: &Compartido, token: String, equipo: &str) -> Result<(), String> {
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
    registro::info(format!("Vinculado como {equipo}"));
    ctx.avisar(Senal::Vinculado);
    Ok(())
}

/// Vinculación sin teclear: el script de instalación deja el código en faro.json.
async fn vincular_solo(ctx: &Ctx, api: &Api, compartido: &Compartido) -> bool {
    let (cfg, codigo) = {
        let n = compartido.lock().unwrap();
        (n.config.clone(), n.config.codigo_vinculo.clone())
    };
    let Some(codigo) = codigo else { return false };
    match api.vincular(&cfg, &codigo, &host(), &sistema()).await {
        Ok((token, equipo)) => {
            let _ = quedar_vinculado(ctx, compartido, token, &equipo);
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

/// Con qué se desbloqueó: la clave de emergencia, una clave temporal del personal (vence) o el código de
/// la reserva vigente (solo quita una suspensión).
#[derive(Debug, Clone, Copy, PartialEq)]
enum Llave {
    Emergencia,
    Temporal(chrono::DateTime<Utc>),
    Reserva,
}

impl Llave {
    fn via(self) -> &'static str {
        match self {
            Llave::Emergencia => "emergencia",
            Llave::Temporal(_) => "clave_temporal",
            Llave::Reserva => "codigo",
        }
    }
}

/// Verifica lo que se escribió en la pantalla contra las llaves permitidas, sin conexión, con pausa de un
/// minuto tras 5 intentos fallidos (cuentan juntos todos los tipos).
fn verificar_llave(n: &mut Nucleo, ingresada: &str, temporal: bool, reserva: bool) -> Result<Llave, String> {
    if let Some(h) = n.espera_hasta {
        if Instant::now() < h {
            return Err("Demasiados intentos. Espere un minuto.".into());
        }
    }
    let ahora = Utc::now() + Dur::milliseconds(n.copia.desfase_ms);
    let Some(r) = n.copia.remoto.as_ref() else {
        return Err("Faro aún no ha recibido datos del laboratorio.".into());
    };
    let mut candidatas: Vec<(Llave, decision::Clave)> = r.clave.iter().map(|c| (Llave::Emergencia, c.clone())).collect();
    if temporal {
        candidatas.extend(r.claves_temporales.iter().filter(|k| k.hasta > ahora).map(|k| {
            (Llave::Temporal(k.hasta), decision::Clave { sal: k.sal.clone(), hash: k.hash.clone(), iteraciones: k.iteraciones })
        }));
    }
    if reserva {
        if let Some(c) = r.actual.as_ref().filter(|o| o.tipo == "reserva" && o.inicio <= ahora && o.fin > ahora).and_then(|o| o.desbloqueo.clone()) {
            candidatas.push((Llave::Reserva, c));
        }
    }
    if candidatas.is_empty() {
        return Err("El laboratorio aún no ha creado una clave de emergencia.".into());
    }
    if clave::normalizar(ingresada).is_empty() {
        return Err("Escriba el código.".into());
    }
    match candidatas.into_iter().find(|(_, c)| clave::huella(&c.sal, ingresada, c.iteraciones) == c.hash) {
        Some((llave, _)) => {
            n.intentos_fallidos = 0;
            Ok(llave)
        }
        None => {
            n.intentos_fallidos += 1;
            // En la pantalla de una reserva, al tercer código equivocado se avisa al titular.
            if reserva && n.intentos_fallidos == 3 {
                n.pendientes.push(("codigos_fallidos".into(), json!({ "intentos": 3 })));
                n.forzar = true;
            }
            if n.intentos_fallidos >= 5 {
                n.intentos_fallidos = 0;
                n.espera_hasta = Some(Instant::now() + Duration::from_secs(60));
            }
            Err(if reserva { "Ese código no desbloquea este equipo." } else { "Clave incorrecta." }.into())
        }
    }
}

/// Solo la clave de emergencia (retirar Faro, desvincular, actualizar desde la línea de comandos).
fn verificar_clave(n: &mut Nucleo, clave_ingresada: &str) -> Result<(), String> {
    verificar_llave(n, clave_ingresada, false, false).map(|_| ())
}

#[tauri::command]
async fn emergencia(app: AppHandle, clave_ingresada: String) -> Result<Value, String> {
    pedir(&app, "emergencia", json!({ "clave": clave_ingresada })).await
}

fn c_emergencia(c: &Compartido, clave: &str) -> Result<(), String> {
    let mut n = c.lock().unwrap();
    let llave = verificar_llave(&mut n, clave, true, false)?;
    desbloquear_emergencia(&mut n, llave);
    Ok(())
}

/// Desbloqueo del personal: con la clave de emergencia por unas horas; con una clave temporal, hasta que
/// esta venza (como mucho las mismas horas). También quita una suspensión.
fn desbloquear_emergencia(n: &mut Nucleo, llave: Llave) {
    let ahora = Utc::now() + Dur::milliseconds(n.copia.desfase_ms);
    let mut hasta = ahora + Dur::hours(EMERGENCIA_HORAS);
    if let Llave::Temporal(h) = llave {
        hasta = hasta.min(h);
    }
    registro::info(format!("Desbloqueo del personal ({}) hasta {}", llave.via(), hasta.with_timezone(&chrono::Local).format("%H:%M")));
    n.copia.memoria.emergencia_hasta = Some(hasta);
    n.pendientes.push(("desbloqueo_emergencia".into(), json!({ "horas": EMERGENCIA_HORAS.to_string(), "via": llave.via() })));
    quitar_suspension_local(n, None);
    n.forzar = true;
    config::guardar_copia(&n.carpeta, &n.copia);
}

/// Marca la suspensión vigente como quitada en este equipo (vale sin conexión) y deja el aviso al servidor
/// para el próximo latido. Devuelve el equipo si había una suspensión.
fn quitar_suspension_local(n: &mut Nucleo, codigo: Option<(&str, Llave)>) -> Option<String> {
    let ahora = Utc::now() + Dur::milliseconds(n.copia.desfase_ms);
    let r = n.copia.remoto.as_ref()?;
    let s = decision::vigente(r, &n.copia.memoria, ahora)?.clone();
    let equipo = r.equipo.codigo.clone();
    let anuncio = r.anuncio.as_ref().map(|a| a.id);
    n.copia.memoria.suspension_quitada = Some(s.desde);
    if s.motivo == "anuncio" {
        n.copia.memoria.anuncio_leido = anuncio;
    }
    // La clave de emergencia no viaja: el servidor se entera por el evento de desbloqueo.
    if let Some((c, llave)) = codigo.filter(|(_, l)| *l != Llave::Emergencia) {
        n.acciones.push(("reanudar".into(), json!({ "codigo": clave::normalizar(c), "via": llave.via() })));
    } else if let Some(id) = anuncio.filter(|_| s.motivo == "anuncio") {
        n.acciones.push(("leido".into(), json!({ "anuncio": id })));
    }
    Some(equipo)
}

/// Quita la pantalla suspendida con el código de la reserva, una clave temporal o la clave de emergencia.
/// Funciona sin conexión: la verificación es local y el servidor se entera después.
#[tauri::command]
async fn quitar_suspension(app: AppHandle, codigo: String) -> Result<Value, String> {
    pedir(&app, "quitar_suspension", json!({ "codigo": codigo })).await
}

fn c_quitar_suspension(c: &Compartido, codigo: &str) -> Result<String, String> {
    let mut n = c.lock().unwrap();
    let llave = verificar_llave(&mut n, codigo, true, true)?;
    if llave == Llave::Emergencia {
        desbloquear_emergencia(&mut n, llave);
        return Ok("Desbloqueado por el personal.".into());
    }
    let equipo = quitar_suspension_local(&mut n, Some((codigo, llave))).ok_or("La pantalla ya no está suspendida.")?;
    registro::info(format!("Suspensión quitada en la pantalla ({})", llave.via()));
    n.forzar = true;
    config::guardar_copia(&n.carpeta, &n.copia);
    Ok(format!("{equipo} quedó desbloqueado."))
}

/// «Entendido» en un anuncio obligatorio.
#[tauri::command]
async fn confirmar_anuncio(app: AppHandle, id: i64) -> Result<Value, String> {
    pedir(&app, "confirmar_anuncio", json!({ "id": id })).await
}

fn c_confirmar_anuncio(c: &Compartido, id: i64) {
    let mut n = c.lock().unwrap();
    n.copia.memoria.anuncio_leido = Some(id);
    n.acciones.push(("leido".into(), json!({ "anuncio": id })));
    n.forzar = true;
    config::guardar_copia(&n.carpeta, &n.copia);
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
async fn qr_llegada(app: AppHandle) -> Result<Value, String> {
    pedir(&app, "qr_llegada", json!({})).await
}

fn c_qr_llegada(c: &Compartido) -> Option<QrLlegada> {
    let n = c.lock().unwrap();
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

/// Borra los archivos que dejó la sesión que acaba de terminar (Descargas y Escritorio de esta cuenta:
/// lo hace la interfaz, que corre en la cuenta) y le avisa al núcleo.
#[tauri::command]
async fn limpiar_sesion(app: AppHandle) -> Result<usize, String> {
    let p = estado_inicial(app.clone());
    let desde = p["vista"]["limpieza_desde"]
        .as_str()
        .and_then(|t| t.parse::<chrono::DateTime<Utc>>().ok())
        .ok_or("No hay una sesión reciente para limpiar.")?;
    let n = ordenes::limpiar(desde)?;
    pedir(&app, "limpieza_hecha", json!({})).await?;
    Ok(n)
}

/// Retira Faro de este PC con la clave de emergencia del laboratorio (sin internet también).
#[tauri::command]
async fn retirar(app: AppHandle, clave_ingresada: String) -> Result<Value, String> {
    pedir(&app, "retirar", json!({ "clave": clave_ingresada })).await
}

async fn c_retirar(ctx: &Ctx, c: &Compartido, clave: &str) -> Result<(), String> {
    let (cfg, token) = {
        let mut n = c.lock().unwrap();
        verificar_clave(&mut n, clave)?;
        (n.config.clone(), n.config.token.clone())
    };
    if ctx.servicio {
        return Err("Con el servicio del sistema, Faro lo retira TI: sudo bash desinstalar-linux.sh".into());
    }
    ordenes::se_puede_retirar()?;
    if let Some(t) = token {
        let _ = Api::new().evento(&cfg, &t, "retirado", json!({ "por": "clave de emergencia" })).await;
    }
    ctx.avisar(Senal::Retirar);
    Ok(())
}

/// QR de una ruta de la app (se arma con la dirección de la PWA que trae el paquete).
#[tauri::command]
fn qr(app: AppHandle, ruta: String) -> Option<String> {
    let base = estado_inicial(app)["url_base"].as_str()?.trim_end_matches('/').to_string();
    qr_svg(&format!("{base}{ruta}"))
}

#[tauri::command]
async fn actualizar_ya(app: AppHandle) -> Result<Value, String> {
    pedir(&app, "actualizar_ya", json!({})).await
}

/// Una acción en la isla: extender (+30 o +60 min), liberar, reportar una falla (con diagnóstico), pedir
/// ayuda o salir un rato. Las reglas las aplica el servidor (las mismas que en la app).
#[tauri::command]
async fn accion_isla(
    app: AppHandle,
    accion: String,
    categoria: Option<String>,
    minutos: Option<u32>,
    mensaje: Option<String>,
    vuelvo_min: Option<u32>,
) -> Result<Value, String> {
    pedir(&app, "accion_isla", json!({ "accion": accion, "categoria": categoria, "minutos": minutos, "mensaje": mensaje, "vuelvo_min": vuelvo_min })).await
}

async fn c_accion_isla(estado: &Compartido, a: &Value) -> Result<String, String> {
    let accion = a["accion"].as_str().unwrap_or("").to_string();
    if !["extender", "liberar", "reportar", "ayuda", "salir"].contains(&accion.as_str()) {
        return Err("Acción no válida.".into());
    }
    let (cfg, token, en_linea, sin_red, desfase) = {
        let n = estado.lock().unwrap();
        let en_linea = n.ultimo_ok.map(|t| t.elapsed() < Duration::from_secs(90)).unwrap_or(false);
        (n.config.clone(), n.config.token.clone(), en_linea, sin_red_seg(&n).map(|s| s as u64), n.copia.desfase_ms)
    };
    let token = token.ok_or("Este equipo no está vinculado.")?;
    let mut datos = json!({});
    if let Some(m) = a["minutos"].as_u64() {
        datos["minutos"] = json!(m);
    }
    if accion == "salir" {
        datos["mensaje"] = json!(a["mensaje"].as_str().map(|m| m.trim().chars().take(120).collect::<String>()).filter(|m| !m.is_empty()));
        datos["vuelvo_min"] = a["vuelvo_min"].clone();
    }
    if accion == "reportar" {
        datos["categoria"] = json!(a["categoria"].as_str().unwrap_or_default());
        datos["diagnostico"] = tokio::task::spawn_blocking(move || diag::rapido(en_linea, sin_red, None, desfase)).await.unwrap_or(json!({}));
    }
    match Api::new().accion(&cfg, &token, &accion, datos).await {
        Ok(t) => {
            registro::info(format!("Acción en la isla: {accion}"));
            estado.lock().unwrap().forzar = true;
            Ok(t)
        }
        Err(Fallo::Mensaje(m)) => {
            registro::aviso(format!("Acción en la isla «{accion}» rechazada: {m}"));
            Err(m)
        }
        Err(Fallo::Red(_)) => Err("No hay conexión con el servidor. Intente de nuevo en un momento.".into()),
        Err(Fallo::NoVinculado) => Err("Este equipo no está vinculado.".into()),
    }
}

/// Órdenes de la línea de comandos (`faro unlock`, `faro link`…). Con Faro por cuenta llegan como un
/// archivo en su carpeta; con el servicio, por el socket. Devuelve la respuesta, lo que hay que hacer
/// después de responder y si hay que intentar vincular ya.
pub(crate) fn procesar_orden(ctx: &Ctx, compartido: &Compartido, o: &cli::OrdenCli) -> (Result<String, String>, Option<&'static str>, bool) {
    let mut vincular_ya = false;
    let mut despues: Option<&'static str> = None;
    let r: Result<String, String> = match o.orden.as_str() {
        // `faro restart`: sin clave (no deja nada abierto) y `faro stop`: con clave (sin Faro no hay bloqueo).
        "reiniciar" => {
            despues = Some("reiniciar");
            Ok("Restarting Faro…".into())
        }
        "detener" => {
            let mut n = compartido.lock().unwrap();
            verificar_llave(&mut n, o.clave.as_deref().unwrap_or(""), true, false).map(|_| {
                despues = Some("detener");
                "Faro stopped. Start it again with «faro start» (it also starts at the next login).".to_string()
            })
        }
        "vincular" => {
            let mut n = compartido.lock().unwrap();
            if n.config.token.is_some() {
                Err("This computer is already linked.".into())
            } else {
                n.config.codigo_vinculo = o.codigo.clone();
                vincular_ya = true;
                Ok("Linking…".into())
            }
        }
        "desbloquear" | "actualizar" | "desvincular" => {
            let mut n = compartido.lock().unwrap();
            let temporal = o.orden == "desbloquear";
            match verificar_llave(&mut n, o.clave.as_deref().unwrap_or(""), temporal, false) {
                Err(e) => Err(e),
                Ok(llave) => match o.orden.as_str() {
                    "desbloquear" => {
                        desbloquear_emergencia(&mut n, llave);
                        Ok(format!("Unlocked for staff (up to {EMERGENCIA_HORAS} h)."))
                    }
                    "actualizar" => {
                        ctx.actualizar.notify_one();
                        Ok("Checking for a new version: if there is one, it installs when nobody is using the computer.".into())
                    }
                    _ => {
                        registro::info("Desvinculado desde la línea de comandos");
                        quedar_desvinculado(ctx, &mut n);
                        Ok("Computer unlinked. Link it again with «faro link CODE».".into())
                    }
                },
            }
        }
        otra => Err(format!("Unknown order: {otra}")),
    };
    match &r {
        Ok(t) => registro::info(format!("Orden de la línea de comandos «{}»: {t}", o.orden)),
        Err(e) => registro::aviso(format!("Orden de la línea de comandos «{}» rechazada: {e}", o.orden)),
    }
    (r, despues, vincular_ya)
}

/// Faro por cuenta: la orden llega como archivo y se responde con otro.
fn revisar_orden_cli(ctx: &Ctx, compartido: &Compartido) -> bool {
    let carpeta = compartido.lock().unwrap().carpeta.clone();
    let ruta = cli::archivo_orden(&carpeta);
    let Ok(texto) = std::fs::read_to_string(&ruta) else { return false };
    let _ = std::fs::remove_file(&ruta);
    let Ok(o) = serde_json::from_str::<cli::OrdenCli>(&texto) else { return false };
    let (r, despues, vincular_ya) = procesar_orden(ctx, compartido, &o);
    let (ok, texto) = match r {
        Ok(t) => (true, t),
        Err(e) => (false, e),
    };
    cli::responder(&carpeta, &o.id, ok, &texto);
    match despues {
        Some("reiniciar") => {
            registro::info("Reinicio pedido desde la línea de comandos");
            vigia::pausar(&carpeta, 30);
            std::thread::sleep(Duration::from_millis(400));
            ctx.avisar(Senal::Reiniciar);
        }
        Some("detener") => {
            registro::aviso("Faro detenido desde la línea de comandos");
            // El vigía no lo vuelve a abrir hasta «faro start» o el próximo inicio de sesión.
            vigia::pausar(&carpeta, 30 * 24 * 3600);
            std::thread::sleep(Duration::from_millis(400));
            #[cfg(target_os = "linux")]
            if cli::servicio_activo() {
                // Con systemd (Restart=always) hay que detener el servicio, o vuelve a arrancar.
                let _ = std::process::Command::new("systemctl").args(["--user", "stop", "ladme-faro.service"]).spawn();
                return vincular_ya;
            }
            ctx.avisar(Senal::Detener);
        }
        _ => {}
    }
    vincular_ya
}

// ------------------------------------------------------------------ arranque

/// El núcleo con lo guardado en la carpeta (de la cuenta o del servicio).
pub(crate) fn nuevo_nucleo(carpeta: PathBuf, reabierto: bool) -> Compartido {
    let config = config::cargar(&carpeta);
    let copia = config::cargar_copia(&carpeta);
    Arc::new(Mutex::new(Nucleo {
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
        acciones: Vec::new(),
    }))
}

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
            registro::iniciar(&carpeta);
            app.manage(Interfaz::default());
            app.manage(isla::iniciar(&carpeta));
            let isla = isla::crear(app.handle())?;
            tauri::async_runtime::spawn(isla::vigilar_cursor(app.handle().clone(), app.state::<isla::Compartida>().inner().clone()));
            tauri::async_runtime::spawn(mantener_bloqueo_encima(app.handle().clone()));

            // Con el servicio del sistema instalado, esta es solo la interfaz de la sesión: el vínculo, el
            // estado y el ciclo con el servidor viven en el servicio.
            #[cfg(unix)]
            if servicio::instalado() && std::env::var_os("FARO_POR_CUENTA").is_none() {
                registro::info(format!("Faro {} (interfaz) arrancó en {}{}", env!("CARGO_PKG_VERSION"), sistema(),
                                       diag::sesion_grafica().map(|s| format!(" (sesión {s})")).unwrap_or_default()));
                // La entrada de inicio de sesión de Faro por cuenta ya no hace falta: la abre systemd.
                #[cfg(not(debug_assertions))]
                {
                    use tauri_plugin_autostart::ManagerExt;
                    let _ = app.autolaunch().disable();
                }
                let r = remoto::Remoto::nuevo();
                app.manage(r.clone());
                tauri::async_runtime::spawn(remoto::correr(app.handle().clone(), r));
                return Ok(());
            }

            registro::info(format!("Faro {} arrancó en {}{}", env!("CARGO_PKG_VERSION"), sistema(),
                                   diag::sesion_grafica().map(|s| format!(" (sesión {s})")).unwrap_or_default()));
            vigia::escribir_pid(&carpeta, "faro.pid");
            #[cfg(not(debug_assertions))]
            cli::instalar_comando();
            vigia::quitar_pausa(&carpeta);
            let reabierto = std::env::args().any(|a| a == vigia::REABIERTO);
            let compartido = nuevo_nucleo(carpeta, reabierto);
            let vinculado = compartido.lock().unwrap().config.token.is_some();
            let manija = app.handle().clone();
            let ctx = Ctx { salida: Arc::new(move |s| atender(&manija, s)), actualizar: Arc::new(tokio::sync::Notify::new()), servicio: false };
            app.manage(ctx.clone());
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

            if vinculado {
                let _ = isla.show();
            } else {
                abrir_vincular(app.handle());
            }
            let despertador = ctx.actualizar.clone();
            tauri::async_runtime::spawn(ciclo(ctx, compartido.clone(), Arc::new(inactividad::segundos)));
            tauri::async_runtime::spawn(actualizaciones(app.handle().clone(), compartido, despertador));
            Ok(())
        })
        .on_window_event(|w, ev| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = ev {
                let etiqueta = w.label();
                if etiqueta == ISLA || etiqueta.starts_with(PREFIJO_BLOQUEO) {
                    api.prevent_close();
                    if etiqueta.starts_with(PREFIJO_BLOQUEO) {
                        let app = w.app_handle().clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = pedir(&app, "evento", json!({ "tipo": "cierre_intentado" })).await;
                        });
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            accion_isla,
            quitar_suspension,
            confirmar_anuncio,
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
            isla::isla_repintar,
            isla::isla_arrastre,
            isla::isla_posicion,
            actualizar_ya
        ])
        .build(tauri::generate_context!())
        .expect("no se pudo iniciar Faro")
        .run(|app, ev| {
            // Cerrar la ventana de vinculación no apaga Faro si el equipo ya está vinculado.
            if let tauri::RunEvent::ExitRequested { code: None, api, .. } = ev {
                let vinculado = estado_inicial(app.clone())["vinculado"].as_bool().unwrap_or(false);
                if vinculado {
                    api.prevent_exit();
                }
            }
        });
}
