// Sin consola en Windows al compilar para distribuir.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // En Linux, WebKitGTK dibuja por defecto con DMA-BUF. Con algunas tarjetas gráficas (sobre todo NVIDIA)
    // una ventana transparente como la isla no borra los cuadros anteriores y cada animación deja rastro.
    // Se usa el camino de memoria compartida, un poco más lento pero sin basura. Quien necesite otra cosa
    // puede fijar la variable antes de abrir Faro (por ejemplo en el servicio de systemd).
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    // En Linux con Wayland (Fedora, Ubuntu 22.04+) una app no puede elegir dónde va su ventana ni
    // quedarse siempre encima: GNOME la pone en el centro. Con XWayland sí puede, así que Faro
    // arranca en ese modo salvo que alguien fije GDK_BACKEND a propósito.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WAYLAND_DISPLAY").is_some() && std::env::var_os("GDK_BACKEND").is_none() {
        std::env::set_var("GDK_BACKEND", "x11");
    }
    // El vigía es este mismo programa con --vigia <carpeta>: un bucle mínimo, sin ventanas.
    let args: Vec<std::ffi::OsString> = std::env::args_os().collect();
    if args.get(1).map(|a| a == faro_lib::ARG_VIGIA).unwrap_or(false) {
        if let Some(carpeta) = args.get(2) {
            faro_lib::correr_vigia(carpeta.into());
        }
        return;
    }
    faro_lib::run()
}
