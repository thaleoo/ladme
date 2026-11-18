// Sin consola en Windows al compilar para distribuir.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // En Linux con Wayland (Fedora, Ubuntu 22.04+) una app no puede elegir dónde va su ventana ni
    // quedarse siempre encima: GNOME la pone en el centro. Con XWayland sí puede, así que Faro
    // arranca en ese modo salvo que alguien fije GDK_BACKEND a propósito.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WAYLAND_DISPLAY").is_some() && std::env::var_os("GDK_BACKEND").is_none() {
        std::env::set_var("GDK_BACKEND", "x11");
    }
    faro_lib::run()
}
