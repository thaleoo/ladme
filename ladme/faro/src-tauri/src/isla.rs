//! La ventana de la isla.
//!
//! Es una ventana transparente de tamaño FIJO (cabe el panel abierto) que nunca cambia de
//! tamaño: así las transiciones son animación pura en CSS. Para que no estorbe, solo la
//! píldora visible recibe clics; en el resto la ventana deja pasar el mouse a lo que hay
//! debajo. La interfaz informa dónde está la píldora (`isla_zona`) y:
//!
//! - En Linux se fija la «forma de entrada» de la ventana a ese rectángulo (X11/XWayland la
//!   respetan): fuera de él los clics pasan solos. Con XWayland no se puede leer el cursor
//!   sobre ventanas nativas de Wayland, así que comparar posiciones no sirve allí.
//! - En Windows, unas 30 veces por segundo se compara la posición del cursor con la zona y se
//!   activa o no el «paso de clics» de toda la ventana.
//!
//! Además: se arrastra y se ajusta a la izquierda, al centro o a la derecha del borde superior
//! (cada PC recuerda su lugar), y avisa a la interfaz cuando hay una app a pantalla completa.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const ETIQUETA: &str = "isla";
/// Tamaño lógico fijo de la ventana: el panel abierto más su sombra.
pub const ANCHO: f64 = 460.0;
pub const ALTO: f64 = 700.0;
const MARGEN: f64 = 12.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Posicion {
    Izquierda,
    #[default]
    Centro,
    Derecha,
}

#[derive(Default)]
pub struct Estado {
    /// Rectángulo de la píldora en coordenadas lógicas de la ventana (x, y, ancho, alto).
    zona: Option<(f64, f64, f64, f64)>,
    arrastre: Option<i32>, // x física de la ventana al empezar a arrastrar
    pasa_clics: Option<bool>,
    dentro: bool,
    completa: bool,
    pub posicion: Posicion,
    carpeta: PathBuf,
}

pub type Compartida = Arc<Mutex<Estado>>;

#[derive(Serialize, Deserialize, Default)]
struct Guardado {
    posicion: Posicion,
}

pub fn iniciar(carpeta: &Path) -> Compartida {
    let posicion = std::fs::read_to_string(carpeta.join("isla.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<Guardado>(&t).ok())
        .map(|g| g.posicion)
        .unwrap_or_default();
    Arc::new(Mutex::new(Estado { posicion, carpeta: carpeta.to_path_buf(), ..Default::default() }))
}

pub fn crear(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(w) = app.get_webview_window(ETIQUETA) {
        return Ok(w);
    }
    let w = WebviewWindowBuilder::new(app, ETIQUETA, WebviewUrl::App("isla.html".into()))
        .title("Faro")
        .inner_size(ANCHO, ALTO)
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
    #[cfg(target_os = "linux")]
    sin_aceleracion(&w);
    if let Some(e) = app.try_state::<Compartida>() {
        let p = e.lock().unwrap().posicion;
        ubicar(&w, p);
    }
    Ok(w)
}

/// Linux, solo para diagnóstico: con `FARO_ISLA_SIN_GPU=1` la isla se dibuja sin aceleración por GPU.
/// En Faro 0.7.1 era lo normal, pero no quitaba los rastros en Fedora (los quita `isla_repintar`).
#[cfg(target_os = "linux")]
fn sin_aceleracion(w: &WebviewWindow) {
    if std::env::var_os("FARO_ISLA_SIN_GPU").is_none() {
        return;
    }
    let r = w.with_webview(|wv| {
        use webkit2gtk::{HardwareAccelerationPolicy, SettingsExt, WebViewExt};
        if let Some(s) = wv.inner().settings() {
            s.set_hardware_acceleration_policy(HardwareAccelerationPolicy::Never);
        }
    });
    if let Err(e) = r {
        crate::registro::aviso(format!("No se pudo quitar la aceleración de la isla: {e}"));
    }
}

/// x física de la ventana para cada lugar del borde superior del monitor principal.
fn x_para(w: &WebviewWindow, p: Posicion) -> Option<(i32, i32)> {
    let m = w.primary_monitor().ok().flatten().or_else(|| w.current_monitor().ok().flatten())?;
    let escala = m.scale_factor();
    let ancho = (ANCHO * escala) as i32;
    let margen = (MARGEN * escala) as i32;
    let (mx, mw) = (m.position().x, m.size().width as i32);
    let x = match p {
        Posicion::Izquierda => mx + margen,
        Posicion::Centro => mx + (mw - ancho) / 2,
        Posicion::Derecha => mx + mw - ancho - margen,
    };
    Some((x, m.position().y))
}

pub fn ubicar(w: &WebviewWindow, p: Posicion) {
    if let Some((x, y)) = x_para(w, p) {
        let _ = w.set_position(PhysicalPosition::new(x, y));
    }
}

/// Mueve la ventana con una animación corta (ease-out) hasta su lugar.
async fn deslizar(w: WebviewWindow, destino: (i32, i32)) {
    let Ok(origen) = w.outer_position() else { return };
    let pasos = 14;
    for i in 1..=pasos {
        let t = i as f64 / pasos as f64;
        let e = 1.0 - (1.0 - t).powi(3);
        let x = origen.x as f64 + (destino.0 - origen.x) as f64 * e;
        let _ = w.set_position(PhysicalPosition::new(x.round() as i32, destino.1));
        tokio::time::sleep(Duration::from_millis(14)).await;
    }
}

// ------------------------------------------------------------------ comandos

/// La interfaz informa dónde está la píldora (ancho 0 = oculta, no recibe clics).
#[tauri::command]
pub fn isla_zona(app: AppHandle, estado: tauri::State<Compartida>, x: f64, y: f64, ancho: f64, alto: f64) {
    let zona = (ancho > 0.0 && alto > 0.0).then_some((x, y, ancho, alto));
    estado.lock().unwrap().zona = zona;
    #[cfg(target_os = "linux")]
    if let Some(w) = app.get_webview_window(ETIQUETA) {
        forma_de_entrada(&w, zona);
    }
    #[cfg(not(target_os = "linux"))]
    let _ = app;
}

/// Linux: la isla terminó de cambiar de tamaño. En algunos escritorios (Fedora 43 con GNOME, con o sin
/// XWayland, con o sin GPU) la ventana transparente conserva los cuadros anteriores y quedan rastros negros
/// que tardan en irse. Estirar la ventana 1 px y devolverla obliga a GTK, a WebKit y al escritorio a
/// rehacer sus búferes desde cero: los rastros desaparecen. El tamaño para la persona no cambia (el píxel
/// extra es transparente y dura un cuadro) y la zona que recibe el mouse tampoco.
#[tauri::command]
pub fn isla_repintar(app: AppHandle) {
    #[cfg(target_os = "linux")]
    if let Some(w) = app.get_webview_window(ETIQUETA) {
        repintar(&w);
    }
    #[cfg(not(target_os = "linux"))]
    let _ = app;
}

#[cfg(target_os = "linux")]
fn repintar(w: &WebviewWindow) {
    let w2 = w.clone();
    let _ = w.run_on_main_thread(move || {
        use gtk::prelude::*;
        let Ok(v) = w2.gtk_window() else { return };
        if !v.is_visible() {
            return;
        }
        let (ancho, alto) = v.size();
        v.set_resizable(true);
        v.resize(ancho, alto + 1);
        if let Some(g) = v.window() {
            g.invalidate_rect(None, true);
        }
        let v2 = v.clone();
        gtk::glib::timeout_add_local_once(std::time::Duration::from_millis(30), move || {
            v2.resize(ancho, alto);
            v2.set_resizable(false);
            if let Some(g) = v2.window() {
                g.invalidate_rect(None, true);
            }
        });
    });
}

/// Linux: solo el rectángulo de la isla recibe el mouse (vacío = la ventana no recibe nada).
/// Las coordenadas son lógicas, igual que en GTK.
#[cfg(target_os = "linux")]
fn forma_de_entrada(w: &WebviewWindow, zona: Option<(f64, f64, f64, f64)>) {
    let w2 = w.clone();
    let _ = w.run_on_main_thread(move || {
        use gtk::prelude::*;
        let Ok(gtk_ventana) = w2.gtk_window() else { return };
        let Some(gdk_ventana) = gtk_ventana.window() else { return }; // aún no se ha mostrado
        let region = match zona {
            Some((x, y, ancho, alto)) => gtk::cairo::Region::create_rectangle(&gtk::cairo::RectangleInt::new(
                x.floor() as i32,
                y.floor() as i32,
                ancho.ceil() as i32,
                alto.ceil() as i32,
            )),
            None => gtk::cairo::Region::create(),
        };
        gdk_ventana.input_shape_combine_region(&region, 0, 0);
    });
}

/// Arrastre horizontal: fase «inicio», «mover» (dx en píxeles lógicos desde el inicio) o «fin».
/// Al soltar, la isla se ajusta al lugar más cercano y este se guarda.
#[tauri::command]
pub fn isla_arrastre(app: AppHandle, estado: tauri::State<Compartida>, fase: String, dx: f64) -> Posicion {
    let Some(w) = app.get_webview_window(ETIQUETA) else { return Posicion::Centro };
    let escala = w.scale_factor().unwrap_or(1.0);
    let mut e = estado.lock().unwrap();
    match fase.as_str() {
        "inicio" => {
            e.arrastre = w.outer_position().ok().map(|p| p.x);
        }
        "mover" => {
            if let (Some(x0), Ok(p)) = (e.arrastre, w.outer_position()) {
                let _ = w.set_position(PhysicalPosition::new(x0 + (dx * escala) as i32, p.y));
            }
        }
        "fin" => {
            e.arrastre = None;
            if let (Ok(p), Ok(Some(m))) = (w.outer_position(), w.primary_monitor()) {
                let centro = p.x + (ANCHO * escala) as i32 / 2 - m.position().x;
                let tercio = m.size().width as i32 / 3;
                e.posicion = if centro < tercio {
                    Posicion::Izquierda
                } else if centro > 2 * tercio {
                    Posicion::Derecha
                } else {
                    Posicion::Centro
                };
            }
            let _ = std::fs::write(e.carpeta.join("isla.json"), serde_json::to_vec(&Guardado { posicion: e.posicion }).unwrap_or_default());
            if let Some(destino) = x_para(&w, e.posicion) {
                tauri::async_runtime::spawn(deslizar(w.clone(), destino));
            }
        }
        _ => {}
    }
    e.posicion
}

#[tauri::command]
pub fn isla_posicion(estado: tauri::State<Compartida>) -> Posicion {
    estado.lock().unwrap().posicion
}

// ------------------------------------------------------------------ ciclo del cursor

/// Unas 30 veces por segundo: ¿está el cursor sobre la píldora? Si no, los clics pasan.
pub async fn vigilar_cursor(app: AppHandle, estado: Compartida) {
    let mut contador: u32 = 0;
    loop {
        tokio::time::sleep(Duration::from_millis(33)).await;
        contador = contador.wrapping_add(1);
        let Some(w) = app.get_webview_window(ETIQUETA) else { continue };
        if !w.is_visible().unwrap_or(false) {
            continue;
        }
        let dentro = {
            let e = estado.lock().unwrap();
            if e.arrastre.is_some() {
                true
            } else if let (Some((zx, zy, zw, zh)), Ok(c), Ok(p), Ok(escala)) =
                (e.zona, app.cursor_position(), w.outer_position(), w.scale_factor())
            {
                let x = (c.x - p.x as f64) / escala;
                let y = (c.y - p.y as f64) / escala;
                x >= zx && x <= zx + zw && y >= zy && y <= zy + zh
            } else {
                false
            }
        };
        let mut e = estado.lock().unwrap();
        // En Linux la forma de entrada ya decide quién recibe el mouse (ver forma_de_entrada) y la
        // interfaz detecta el paso del mouse por sí misma.
        if cfg!(not(target_os = "linux")) {
            if e.pasa_clics != Some(!dentro) {
                e.pasa_clics = Some(!dentro);
                let _ = w.set_ignore_cursor_events(!dentro);
            }
            if e.dentro != dentro {
                e.dentro = dentro;
                let _ = app.emit("faro://dentro", dentro);
            }
        }
        // Cada segundo: se reaplica la forma de entrada en Linux (por si la ventana aún no
        // existía cuando la interfaz informó la zona) y se revisa si hay pantalla completa.
        if contador % 30 == 0 {
            #[cfg(target_os = "linux")]
            forma_de_entrada(&w, e.zona);
            let completa = pantalla_completa();
            if completa != e.completa {
                e.completa = completa;
                let _ = app.emit("faro://pantalla-completa", completa);
            }
        }
    }
}

// ------------------------------------------------------------------ pantalla completa

/// Windows: el estado de notificaciones del usuario dice si hay una app a pantalla completa,
/// una presentación o un juego.
#[cfg(windows)]
pub fn pantalla_completa() -> bool {
    use windows_sys::Win32::UI::Shell::SHQueryUserNotificationState;
    let mut estado = 0;
    // SAFETY: solo escribe el entero que se le pasa.
    let ok = unsafe { SHQueryUserNotificationState(&mut estado) };
    // 2 = ocupado (pantalla completa), 3 = juego Direct3D, 4 = modo presentación.
    ok == 0 && matches!(estado, 2..=4)
}

/// Linux (X11 o XWayland): la ventana activa tiene _NET_WM_STATE_FULLSCREEN.
#[cfg(target_os = "linux")]
pub fn pantalla_completa() -> bool {
    use std::sync::OnceLock;
    use x11_dl::xlib::{self, Xlib};
    struct X {
        xlib: Xlib,
        pantalla: *mut xlib::Display,
        activa: xlib::Atom,
        estado: xlib::Atom,
        completa: xlib::Atom,
    }
    // SAFETY: la conexión se usa solo desde el ciclo del cursor, protegida por el Mutex.
    unsafe impl Send for X {}
    static X11: OnceLock<Option<Mutex<X>>> = OnceLock::new();
    let x = X11.get_or_init(|| {
        std::env::var_os("DISPLAY")?;
        let xlib = Xlib::open().ok()?;
        unsafe {
            let pantalla = (xlib.XOpenDisplay)(std::ptr::null());
            if pantalla.is_null() {
                return None;
            }
            let atomo = |n: &str| (xlib.XInternAtom)(pantalla, std::ffi::CString::new(n).unwrap().as_ptr(), 0);
            let (activa, estado, completa) = (atomo("_NET_ACTIVE_WINDOW"), atomo("_NET_WM_STATE"), atomo("_NET_WM_STATE_FULLSCREEN"));
            Some(Mutex::new(X { xlib, pantalla, activa, estado, completa }))
        }
    });
    let Some(x) = x.as_ref().and_then(|m| m.lock().ok()) else { return false };
    unsafe {
        let leer = |ventana: xlib::Window, propiedad: xlib::Atom, tipo: xlib::Atom| -> Vec<u64> {
            let (mut t, mut f, mut n, mut resto) = (0, 0, 0, 0);
            let mut datos: *mut u8 = std::ptr::null_mut();
            let r = (x.xlib.XGetWindowProperty)(x.pantalla, ventana, propiedad, 0, 64, 0, tipo, &mut t, &mut f, &mut n, &mut resto, &mut datos);
            if r != 0 || datos.is_null() {
                return vec![];
            }
            let v = if f == 32 { std::slice::from_raw_parts(datos as *const std::os::raw::c_ulong, n as usize).iter().map(|&a| a as u64).collect() } else { vec![] };
            (x.xlib.XFree)(datos as *mut _);
            v
        };
        let raiz = (x.xlib.XDefaultRootWindow)(x.pantalla);
        let Some(&activa) = leer(raiz, x.activa, xlib::XA_WINDOW).first() else { return false };
        activa != 0 && leer(activa as xlib::Window, x.estado, xlib::XA_ATOM).contains(&(x.completa as u64))
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
pub fn pantalla_completa() -> bool {
    false
}
