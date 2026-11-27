//! Lo propio de Linux del servicio del sistema: systemd, el socket de Unix y loginctl.

use super::Flujo;
use crate::registro;
use std::path::{Path, PathBuf};
use std::time::Duration;

const SOCKET: &str = "/run/ladme-faro/faro.sock";
pub const COMO_INICIAR: &str = "sudo systemctl start ladme-faro-servicio";
/// Las interfaces las abre systemd al iniciar sesión: el guardián espera a que lo intente primero.
pub const ESPERA_GUARDIAN: Duration = Duration::from_secs(40);
/// Claves de latest.json, en orden de preferencia.
pub const PLATAFORMAS: &[&str] = &["linux-x86_64-appimage", "linux-x86_64"];

pub fn carpeta() -> PathBuf {
    PathBuf::from("/var/lib/ladme-faro")
}

/// Donde el instalador deja el programa (el servicio lo reemplaza al actualizarse).
pub fn programa() -> PathBuf {
    PathBuf::from("/opt/ladme-faro/ladme-faro.AppImage")
}

/// ¿Está instalado el servicio del sistema en este equipo?
pub fn instalado() -> bool {
    Path::new("/etc/systemd/system/ladme-faro-servicio.service").is_file()
}

pub fn entrada() {
    super::correr()
}

pub fn proteger_carpeta(carpeta: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(carpeta, std::fs::Permissions::from_mode(0o700));
}

pub fn limpiar_anterior() {}

pub fn reiniciar() -> ! {
    // systemd (Restart=always) lo vuelve a abrir.
    std::process::exit(0)
}

pub fn detener() {
    let _ = std::process::Command::new("systemctl").args(["stop", "ladme-faro-servicio.service"]).spawn();
}

pub async fn escuchar(atender: impl Fn(Box<dyn Flujo>, u32) + Send + 'static) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::create_dir_all("/run/ladme-faro");
    let _ = std::fs::remove_file(SOCKET);
    let oyente = tokio::net::UnixListener::bind(SOCKET)?;
    // Cualquier cuenta conecta su interfaz; lo que cambia algo pide clave o lo decide el servidor.
    let _ = std::fs::set_permissions(SOCKET, std::fs::Permissions::from_mode(0o666));
    loop {
        if let Ok((con, _)) = oyente.accept().await {
            let uid = con.peer_cred().map(|p| p.uid()).unwrap_or(u32::MAX);
            atender(Box::new(con), uid);
        }
    }
}

pub async fn conectar() -> std::io::Result<Box<dyn Flujo>> {
    Ok(Box::new(tokio::net::UnixStream::connect(SOCKET).await?))
}

pub fn conectar_bloqueante() -> std::io::Result<(Box<dyn std::io::Read + Send>, Box<dyn std::io::Write + Send>)> {
    let con = std::os::unix::net::UnixStream::connect(SOCKET)?;
    Ok((Box::new(con.try_clone()?), Box::new(con)))
}

/// Usuario y uid de la sesión gráfica activa del puesto (loginctl).
pub fn sesion_activa() -> Option<(String, u32)> {
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

pub fn abrir_interfaz(usuario: &str, _uid: u32) -> Result<(), String> {
    let ok = std::process::Command::new("systemctl")
        .args(["--user", "-M", &format!("{usuario}@"), "start", "ladme-faro.service"])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if ok { Ok(()) } else { Err(format!("systemctl --user -M {usuario}@ start ladme-faro.service falló")) }
}

/// Reemplaza el programa sin dejarlo a medias: archivo nuevo al lado y rename.
pub fn instalar(datos: &[u8]) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let destino = programa();
    let nuevo = destino.with_extension("AppImage.nuevo");
    std::fs::write(&nuevo, datos).map_err(|e| e.to_string())?;
    std::fs::set_permissions(&nuevo, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    std::fs::rename(&nuevo, &destino).map_err(|e| e.to_string())?;
    registro::info(format!("Programa reemplazado en {}", destino.display()));
    Ok(())
}
