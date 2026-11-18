//! Segundos desde el último uso del teclado o el mouse. `None` si el sistema no
//! lo permite saber (p. ej. Linux con Wayland): entonces Faro no marca uso.

#[cfg(windows)]
pub fn segundos() -> Option<u64> {
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    // SAFETY: la estructura está inicializada con su tamaño, como pide la API.
    let ok = unsafe { GetLastInputInfo(&mut info) };
    if ok == 0 {
        return None;
    }
    let ahora = unsafe { GetTickCount() };
    Some((ahora.wrapping_sub(info.dwTime) / 1000) as u64)
}

/// En Linux: con Wayland se pregunta a GNOME por D-Bus (XScreenSaver solo vería las ventanas de
/// XWayland y creería que el PC está quieto aunque alguien escriba en Firefox). En X11, XScreenSaver.
/// Se consulta como máximo cada 4 s; entre consultas se suma el tiempo transcurrido.
#[cfg(target_os = "linux")]
pub fn segundos() -> Option<u64> {
    use std::sync::Mutex;
    use std::time::{Duration, Instant};
    static CACHE: Mutex<Option<(Instant, Option<u64>)>> = Mutex::new(None);
    let mut c = CACHE.lock().ok()?;
    if let Some((cuando, valor)) = *c {
        if cuando.elapsed() < Duration::from_secs(4) {
            return valor.map(|v| v + cuando.elapsed().as_secs());
        }
    }
    let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some()
        || std::env::var("XDG_SESSION_TYPE").map(|t| t == "wayland").unwrap_or(false);
    let valor = if wayland { gnome() } else { x11() };
    *c = Some((Instant::now(), valor));
    valor
}

#[cfg(target_os = "linux")]
fn gnome() -> Option<u64> {
    let salida = std::process::Command::new("gdbus")
        .args(["call", "--session", "--dest", "org.gnome.Mutter.IdleMonitor",
               "--object-path", "/org/gnome/Mutter/IdleMonitor/Core",
               "--method", "org.gnome.Mutter.IdleMonitor.GetIdletime"])
        .output()
        .ok()?;
    if !salida.status.success() {
        return None;
    }
    leer_gdbus(&String::from_utf8_lossy(&salida.stdout)).map(|ms| ms / 1000)
}

/// «(uint64 12345,)» → 12345
#[cfg(target_os = "linux")]
fn leer_gdbus(t: &str) -> Option<u64> {
    t.split(|c: char| !c.is_ascii_digit()).filter(|p| !p.is_empty()).nth(1)?.parse().ok()
}

#[cfg(target_os = "linux")]
fn x11() -> Option<u64> {
    use std::sync::OnceLock;
    use x11_dl::{xlib::Xlib, xss::Xss};
    struct X {
        xlib: Xlib,
        xss: Xss,
        pantalla: *mut x11_dl::xlib::Display,
    }
    // SAFETY: la conexión se usa solo desde el hilo de Faro, protegida por el Mutex.
    unsafe impl Send for X {}
    static X11: OnceLock<Option<std::sync::Mutex<X>>> = OnceLock::new();
    let x = X11.get_or_init(|| {
        if std::env::var_os("DISPLAY").is_none() {
            return None;
        }
        let xlib = Xlib::open().ok()?;
        let xss = Xss::open().ok()?;
        let pantalla = unsafe { (xlib.XOpenDisplay)(std::ptr::null()) };
        if pantalla.is_null() {
            return None;
        }
        Some(std::sync::Mutex::new(X { xlib, xss, pantalla }))
    });
    let x = x.as_ref()?.lock().ok()?;
    unsafe {
        let info = (x.xss.XScreenSaverAllocInfo)();
        if info.is_null() {
            return None;
        }
        let raiz = (x.xlib.XDefaultRootWindow)(x.pantalla);
        let ok = (x.xss.XScreenSaverQueryInfo)(x.pantalla, raiz, info);
        let ms = (*info).idle;
        (x.xlib.XFree)(info as *mut _);
        if ok == 0 { None } else { Some(ms / 1000) }
    }
}

#[cfg(all(test, target_os = "linux"))]
mod pruebas {
    #[test]
    fn lee_la_respuesta_de_gnome() {
        assert_eq!(super::leer_gdbus("(uint64 12345,)\n"), Some(12345));
        assert_eq!(super::leer_gdbus("Error: no existe"), None);
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
pub fn segundos() -> Option<u64> {
    None
}
