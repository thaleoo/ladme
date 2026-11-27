//! Registro local de Faro: `faro.log` en la carpeta de Faro de la cuenta. Lo lee `faro logs` y sirve para
//! entender qué pasó en un equipo sin abrir el panel. Guarda lo que hace Faro (arranque, conexión, órdenes,
//! acciones, bloqueos, actualizaciones), nunca lo que hace la persona.
//!
//! Cuando el archivo pasa de 512 KB se renombra a `faro.log.1` (se conserva uno anterior).

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const MAXIMO: u64 = 512 * 1024;

static RUTA: OnceLock<PathBuf> = OnceLock::new();
static CERROJO: Mutex<()> = Mutex::new(());

pub fn ruta(carpeta: &Path) -> PathBuf {
    carpeta.join("faro.log")
}

/// Desde aquí, todo lo que se registre va a la carpeta de Faro.
pub fn iniciar(carpeta: &Path) {
    let _ = std::fs::create_dir_all(carpeta);
    let _ = RUTA.set(ruta(carpeta));
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Nivel {
    Info,
    Aviso,
    Error,
}

impl Nivel {
    pub fn texto(self) -> &'static str {
        match self {
            Nivel::Info => "INFO",
            Nivel::Aviso => "AVISO",
            Nivel::Error => "ERROR",
        }
    }
    pub fn desde(t: &str) -> Option<Nivel> {
        match t.to_lowercase().as_str() {
            "info" => Some(Nivel::Info),
            "aviso" | "warn" | "advertencia" => Some(Nivel::Aviso),
            "error" => Some(Nivel::Error),
            _ => None,
        }
    }
}

pub fn info(texto: impl AsRef<str>) {
    escribir(Nivel::Info, texto.as_ref());
}
pub fn aviso(texto: impl AsRef<str>) {
    escribir(Nivel::Aviso, texto.as_ref());
}
pub fn error(texto: impl AsRef<str>) {
    escribir(Nivel::Error, texto.as_ref());
}

fn escribir(nivel: Nivel, texto: &str) {
    let linea = format!("{} {:<5} {}\n", chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%:z"), nivel.texto(), texto.replace('\n', " "));
    if cfg!(debug_assertions) {
        eprint!("{linea}");
    }
    let Some(ruta) = RUTA.get() else { return };
    let _g = CERROJO.lock();
    if std::fs::metadata(ruta).map(|m| m.len() > MAXIMO).unwrap_or(false) {
        let _ = std::fs::rename(ruta, ruta.with_extension("log.1"));
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(ruta) {
        let _ = f.write_all(linea.as_bytes());
    }
}

/// Una línea del registro ya separada.
#[derive(Debug, Clone, PartialEq)]
pub struct Linea {
    pub hora: chrono::DateTime<chrono::FixedOffset>,
    pub nivel: Nivel,
    pub texto: String,
}

pub fn separar(l: &str) -> Option<Linea> {
    let mut partes = l.splitn(3, ' ');
    let hora = chrono::DateTime::parse_from_rfc3339(partes.next()?).ok()?;
    let nivel = Nivel::desde(partes.next()?.trim())?;
    Some(Linea { hora, nivel, texto: partes.next().unwrap_or("").trim_start().to_string() })
}

/// Las últimas líneas (de este archivo y del anterior), con filtros opcionales.
pub fn leer(carpeta: &Path, ultimas: usize, desde: Option<chrono::DateTime<chrono::FixedOffset>>, minimo: Nivel) -> Vec<Linea> {
    let r = ruta(carpeta);
    let mut texto = std::fs::read_to_string(r.with_extension("log.1")).unwrap_or_default();
    texto.push_str(&std::fs::read_to_string(&r).unwrap_or_default());
    let todas: Vec<Linea> = texto
        .lines()
        .filter_map(separar)
        .filter(|l| l.nivel >= minimo && desde.map(|d| l.hora >= d).unwrap_or(true))
        .collect();
    let inicio = todas.len().saturating_sub(ultimas);
    todas[inicio..].to_vec()
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn separa_y_filtra() {
        let dir = std::env::temp_dir().join(format!("faro-registro-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            ruta(&dir),
            "2026-11-26T10:00:00-05:00 INFO  Faro 0.6.0 arrancó\n\
             basura sin formato\n\
             2026-11-26T10:05:00-05:00 AVISO Sin conexión con el servidor\n\
             2026-11-26T10:06:00-05:00 ERROR La orden falló\n",
        )
        .unwrap();
        let todas = leer(&dir, 100, None, Nivel::Info);
        assert_eq!(todas.len(), 3);
        assert_eq!(todas[0].texto, "Faro 0.6.0 arrancó");
        assert_eq!(leer(&dir, 100, None, Nivel::Aviso).len(), 2);
        assert_eq!(leer(&dir, 1, None, Nivel::Info)[0].nivel, Nivel::Error);
        let desde = chrono::DateTime::parse_from_rfc3339("2026-11-26T10:05:30-05:00").unwrap();
        assert_eq!(leer(&dir, 100, Some(desde), Nivel::Info).len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
