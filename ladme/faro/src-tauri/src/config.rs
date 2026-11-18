//! Configuración y copia local.
//!
//! Orden de lectura (lo último gana):
//!   1. Valores compilados (FARO_SUPABASE_URL, FARO_SUPABASE_KEY, FARO_PWA_URL al compilar).
//!   2. Archivo del equipo, si TI lo deja: C:\ProgramData\LADME\faro.json o /etc/ladme/faro.json.
//!   3. faro.json en la carpeta de la cuenta (aquí se guarda el token al vincular).

use crate::decision::{Memoria, Remoto};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Config {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub supabase_url: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub supabase_key: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub pwa_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub equipo: Option<String>,
}

impl Config {
    fn mezclar(&mut self, o: Config) {
        if !o.supabase_url.is_empty() { self.supabase_url = o.supabase_url; }
        if !o.supabase_key.is_empty() { self.supabase_key = o.supabase_key; }
        if !o.pwa_url.is_empty() { self.pwa_url = o.pwa_url; }
        if o.token.is_some() { self.token = o.token; }
        if o.equipo.is_some() { self.equipo = o.equipo; }
    }

    pub fn completa(&self) -> bool {
        !self.supabase_url.is_empty() && !self.supabase_key.is_empty()
    }

    /// Dirección de la PWA para el QR y los enlaces; `None` si no se configuró.
    pub fn url_pwa(&self, ruta: &str) -> Option<String> {
        (!self.pwa_url.is_empty()).then(|| format!("{}{ruta}", self.pwa_url.trim_end_matches('/')))
    }
}

fn leer<T: for<'de> Deserialize<'de>>(p: &Path) -> Option<T> {
    serde_json::from_str(&std::fs::read_to_string(p).ok()?).ok()
}

fn archivo_equipo() -> PathBuf {
    if cfg!(windows) {
        PathBuf::from(std::env::var("ProgramData").unwrap_or_else(|_| r"C:\ProgramData".into())).join("LADME").join("faro.json")
    } else {
        PathBuf::from("/etc/ladme/faro.json")
    }
}

pub fn cargar(carpeta: &Path) -> Config {
    let mut c = Config {
        supabase_url: option_env!("FARO_SUPABASE_URL").unwrap_or("").into(),
        supabase_key: option_env!("FARO_SUPABASE_KEY").unwrap_or("").into(),
        pwa_url: option_env!("FARO_PWA_URL").unwrap_or("").into(),
        ..Default::default()
    };
    if let Some(o) = leer::<Config>(&archivo_equipo()) {
        c.mezclar(o);
    }
    if let Some(o) = leer::<Config>(&carpeta.join("faro.json")) {
        c.mezclar(o);
    }
    c
}

/// Guarda solo lo propio de esta cuenta (token y equipo), sin repetir las URLs compiladas.
pub fn guardar_vinculo(carpeta: &Path, token: Option<&str>, equipo: Option<&str>) -> std::io::Result<()> {
    std::fs::create_dir_all(carpeta)?;
    let mut actual = leer::<Config>(&carpeta.join("faro.json")).unwrap_or_default();
    actual.token = token.map(Into::into);
    actual.equipo = equipo.map(Into::into);
    escribir(&carpeta.join("faro.json"), &actual)
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Copia {
    pub remoto: Option<Remoto>,
    /// Diferencia servidor − este PC, en milisegundos.
    pub desfase_ms: i64,
    pub recibido_en: Option<DateTime<Utc>>,
    pub memoria: Memoria,
    pub bloqueado: bool,
}

pub fn cargar_copia(carpeta: &Path) -> Copia {
    leer(&carpeta.join("estado.json")).unwrap_or_default()
}

pub fn guardar_copia(carpeta: &Path, c: &Copia) {
    let _ = std::fs::create_dir_all(carpeta).and_then(|_| escribir(&carpeta.join("estado.json"), c));
}

fn escribir<T: Serialize>(p: &Path, v: &T) -> std::io::Result<()> {
    let tmp = p.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(v)?)?;
    std::fs::rename(tmp, p)
}
