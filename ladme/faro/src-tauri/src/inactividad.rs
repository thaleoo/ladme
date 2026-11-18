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

#[cfg(target_os = "linux")]
pub fn segundos() -> Option<u64> {
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
        if ok == 0 { None } else { Some((ms / 1000) as u64) }
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
pub fn segundos() -> Option<u64> {
    None
}
