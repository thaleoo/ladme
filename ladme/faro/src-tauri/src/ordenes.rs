//! Lo que Faro hace en el PC por orden del panel (o del personal con la clave de emergencia):
//! despertar equipos por la red, apagar, retirarse del equipo y borrar los archivos de una sesión.
//! También el código del QR de llegada, que cambia cada 30 s.

use chrono::{DateTime, Utc};
use sha2::{Digest, Sha256};
use std::path::Path;
use tauri::AppHandle;

/// Mismo cálculo que `_faro_codigo_llegada` en la base de datos.
pub fn codigo_llegada(secreto: &str, equipo: &str, ventana: i64) -> String {
    hex::encode(Sha256::digest(format!("{secreto}:{equipo}:{ventana}").as_bytes()))[..10].to_string()
}

/// Wake-on-LAN: «paquete mágico» (6 × 0xFF y la MAC 16 veces) por difusión UDP.
/// Se envía por cada tarjeta de red con IPv4 a su dirección de difusión (p. ej. 10.0.5.255) y
/// también a 255.255.255.255, a los puertos 9 y 7, tres veces: en Windows la difusión general
/// solo sale por la tarjeta principal, y algunos equipos ignoran el primer paquete.
pub fn despertar(macs: &[String]) -> Result<usize, String> {
    let paquetes: Vec<Vec<u8>> = macs
        .iter()
        .filter_map(|mac| {
            let bytes: Vec<u8> = mac.split([':', '-']).filter_map(|p| u8::from_str_radix(p, 16).ok()).collect();
            (bytes.len() == 6).then(|| {
                let mut p = vec![0xFFu8; 6];
                for _ in 0..16 {
                    p.extend_from_slice(&bytes);
                }
                p
            })
        })
        .collect();
    if paquetes.is_empty() {
        return Ok(0);
    }
    // (dirección local, difusión) de cada tarjeta IPv4 que no sea la de bucle local.
    let mut destinos: Vec<(std::net::Ipv4Addr, std::net::Ipv4Addr)> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter(|i| !i.is_loopback())
        .filter_map(|i| match i.addr {
            if_addrs::IfAddr::V4(v4) => Some((v4.ip, v4.broadcast.unwrap_or(std::net::Ipv4Addr::BROADCAST))),
            _ => None,
        })
        .collect();
    destinos.push((std::net::Ipv4Addr::UNSPECIFIED, std::net::Ipv4Addr::BROADCAST));
    let mut alguno = false;
    for _ in 0..3 {
        for (local, difusion) in &destinos {
            let Ok(socket) = std::net::UdpSocket::bind((*local, 0)) else { continue };
            if socket.set_broadcast(true).is_err() {
                continue;
            }
            for p in &paquetes {
                for puerto in [9, 7] {
                    alguno |= socket.send_to(p, (*difusion, puerto)).is_ok();
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    if alguno {
        Ok(paquetes.len())
    } else {
        Err("no se pudo enviar el paquete por ninguna tarjeta de red".into())
    }
}

/// Apaga el PC en un minuto (Windows muestra su propio aviso).
pub fn apagar() -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("shutdown")
            .args(["/s", "/t", "60", "/c", "LADME: el laboratorio apagará este equipo en 1 minuto. Guarde su trabajo."])
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_secs(60));
            let _ = std::process::Command::new("systemctl").arg("poweroff").status();
        });
        Ok(())
    }
}

/// ¿Se puede quitar Faro sin permisos de administrador? (no si se instaló como .deb o .rpm)
pub fn se_puede_retirar() -> Result<(), String> {
    use tauri::utils::{config::BundleType, platform::bundle_type};
    match bundle_type() {
        Some(BundleType::Deb) | Some(BundleType::Rpm) => {
            Err("Faro está instalado como paquete del sistema: TI debe quitarlo con dnf o apt.".into())
        }
        _ => Ok(()),
    }
}

/// Quita Faro de este PC: configuración, arranque automático, programa. Termina el proceso.
pub fn retirar(app: &AppHandle, carpeta: &Path) -> Result<(), String> {
    se_puede_retirar()?;
    crate::vigia::pausar(carpeta, 3600);
    // Sin faro.json el vigía se retira solo y no vuelve a abrir Faro.
    let _ = std::fs::remove_file(carpeta.join("faro.json"));
    #[cfg(not(debug_assertions))]
    {
        use tauri_plugin_autostart::ManagerExt;
        let _ = app.autolaunch().disable();
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())) {
            let desinstalador = dir.join("uninstall.exe");
            if desinstalador.exists() {
                // El desinstalador espera a que Faro se cierre; se lanza aparte y Faro sale.
                let _ = std::process::Command::new(desinstalador).arg("/S").creation_flags(0x0000_0008).spawn();
            }
        }
        let _ = std::fs::remove_dir_all(carpeta);
        app.exit(0);
    }

    #[cfg(target_os = "linux")]
    {
        let config = dirs::config_dir().unwrap_or_default();
        let unidad = config.join("systemd/user/ladme-faro.service");
        let gestionado = unidad.exists();
        if gestionado {
            let _ = std::process::Command::new("systemctl").args(["--user", "disable", "ladme-faro.service"]).status();
            let _ = std::fs::remove_file(&unidad);
            let _ = std::process::Command::new("systemctl").args(["--user", "daemon-reload"]).status();
        }
        if let Some(appimage) = std::env::var_os("APPIMAGE") {
            let _ = std::fs::remove_file(appimage);
        }
        let _ = std::fs::remove_dir_all(carpeta);
        if gestionado {
            // Detener el servicio termina este mismo proceso: es lo último que se hace.
            let _ = std::process::Command::new("systemctl").args(["--user", "stop", "ladme-faro.service"]).spawn();
            std::thread::sleep(std::time::Duration::from_secs(2));
        }
        app.exit(0);
    }

    #[allow(unreachable_code)]
    Ok(())
}

/// Borra los archivos que se crearon o cambiaron en Descargas y Escritorio desde `desde`
/// (la sesión que terminó). No toca accesos directos ni carpetas que ya existían antes.
pub fn limpiar(desde: DateTime<Utc>) -> Result<usize, String> {
    let limite: std::time::SystemTime = desde.into();
    let mut borrados = 0;
    for carpeta in [dirs::download_dir(), dirs::desktop_dir()].into_iter().flatten() {
        let Ok(entradas) = std::fs::read_dir(&carpeta) else { continue };
        for entrada in entradas.flatten() {
            let ruta = entrada.path();
            let nombre = entrada.file_name().to_string_lossy().to_lowercase();
            if nombre.ends_with(".lnk") || nombre.ends_with(".desktop") || nombre.ends_with(".url") || nombre == "desktop.ini" || nombre.starts_with('.') {
                continue;
            }
            let Ok(meta) = entrada.metadata() else { continue };
            if meta.is_dir() {
                // Solo carpetas CREADAS durante la sesión (la fecha de cambio no basta).
                if meta.created().map(|c| c >= limite).unwrap_or(false) && std::fs::remove_dir_all(&ruta).is_ok() {
                    borrados += 1;
                }
            } else if meta.modified().map(|m| m >= limite).unwrap_or(false) && std::fs::remove_file(&ruta).is_ok() {
                borrados += 1;
            }
        }
    }
    Ok(borrados)
}

#[cfg(test)]
mod pruebas {
    #[test]
    fn codigo_de_llegada_igual_que_la_base_de_datos() {
        // Valor calculado con _faro_codigo_llegada('abc', 'UNAL-08', 123) en PostgreSQL.
        assert_eq!(super::codigo_llegada("abc", "UNAL-08", 123), "e615fa3d14");
        assert_eq!(super::codigo_llegada("abc", "UNAL-08", 123).len(), 10);
    }

    #[test]
    fn paquete_magico_no_falla_con_mac_invalida() {
        assert_eq!(super::despertar(&["no-es-mac".into()]).unwrap(), 0);
    }
}
