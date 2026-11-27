//! Llamadas a Supabase (PostgREST). Faro no tiene sesión de usuario: usa la clave
//! pública del proyecto y se identifica con su token en cada llamada.

use crate::config::Config;
use crate::decision::Remoto;
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Debug)]
pub enum Fallo {
    /// El servidor no reconoce el token (lo desvincularon o lo vincularon de nuevo en otro PC).
    NoVinculado,
    /// Error con mensaje para mostrar (p. ej. código vencido).
    Mensaje(String),
    /// Sin red o el servidor no respondió.
    Red(String),
}

pub struct Api {
    cliente: reqwest::Client,
}

impl Api {
    pub fn new() -> Self {
        let cliente = reqwest::Client::builder()
            .timeout(Duration::from_secs(8))
            .user_agent(concat!("LADME-Faro/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("cliente HTTP");
        Api { cliente }
    }

    async fn rpc(&self, c: &Config, funcion: &str, cuerpo: Value) -> Result<Value, Fallo> {
        if !c.completa() {
            return Err(Fallo::Mensaje("Falta la dirección del servidor en la configuración de Faro.".into()));
        }
        let url = format!("{}/rest/v1/rpc/{funcion}", c.supabase_url.trim_end_matches('/'));
        let mut req = self.cliente.post(url).header("apikey", &c.supabase_key).json(&cuerpo);
        // Las claves «anon» antiguas son JWT y también van en Authorization; las nuevas (sb_publishable_) no.
        if c.supabase_key.starts_with("eyJ") {
            req = req.bearer_auth(&c.supabase_key);
        }
        let resp = req.send().await.map_err(|e| Fallo::Red(e.to_string()))?;
        let estado = resp.status();
        let valor: Value = resp.json().await.unwrap_or(Value::Null);
        if estado.is_success() {
            return Ok(valor);
        }
        if valor["code"] == "28000" {
            return Err(Fallo::NoVinculado);
        }
        if estado.is_server_error() {
            return Err(Fallo::Red(format!("El servidor respondió {estado}")));
        }
        Err(Fallo::Mensaje(valor["message"].as_str().unwrap_or("Error desconocido").to_string()))
    }

    pub async fn vincular(&self, c: &Config, codigo: &str, host: &str, so: &str) -> Result<(String, String), Fallo> {
        let v = self
            .rpc(c, "faro_vincular", json!({ "p_codigo": codigo, "p_host": host, "p_so": so, "p_version": env!("CARGO_PKG_VERSION") }))
            .await?;
        match (v["token"].as_str(), v["equipo"].as_str()) {
            (Some(t), Some(e)) => Ok((t.to_string(), e.to_string())),
            _ => Err(Fallo::Mensaje("Respuesta inesperada del servidor.".into())),
        }
    }

    pub async fn estado(&self, c: &Config, token: &str, info: Value) -> Result<Remoto, Fallo> {
        let v = self.rpc(c, "faro_estado", json!({ "p_token": token, "p_info": info })).await?;
        serde_json::from_value(v).map_err(|e| Fallo::Mensaje(format!("Respuesta inesperada del servidor: {e}")))
    }

    pub async fn evento(&self, c: &Config, token: &str, tipo: &str, detalle: Value) -> Result<(), Fallo> {
        self.rpc(c, "faro_evento", json!({ "p_token": token, "p_tipo": tipo, "p_detalle": detalle })).await.map(|_| ())
    }

    /// Una acción hecha en la isla (extender, liberar, reportar, ayuda). Devuelve el texto para mostrar.
    pub async fn accion(&self, c: &Config, token: &str, accion: &str, datos: Value) -> Result<String, Fallo> {
        let v = self.rpc(c, "faro_accion", json!({ "p_token": token, "p_accion": accion, "p_datos": datos })).await?;
        Ok(v["texto"].as_str().unwrap_or("Listo.").to_string())
    }

    /// ¿Responde el servidor? Devuelve la demora en milisegundos y su hora (cabecera Date), para
    /// `faro doctor`. No cuenta como latido ni recoge órdenes.
    pub async fn ping(&self, c: &Config) -> Result<(u128, Option<chrono::DateTime<chrono::Utc>>), Fallo> {
        if !c.completa() {
            return Err(Fallo::Mensaje("Falta la dirección del servidor en la configuración de Faro.".into()));
        }
        let inicio = std::time::Instant::now();
        let resp = self
            .cliente
            .get(format!("{}/rest/v1/", c.supabase_url.trim_end_matches('/')))
            .header("apikey", &c.supabase_key)
            .send()
            .await
            .map_err(|e| Fallo::Red(e.to_string()))?;
        let ms = inicio.elapsed().as_millis();
        let hora = resp
            .headers()
            .get("date")
            .and_then(|h| h.to_str().ok())
            .and_then(|t| chrono::DateTime::parse_from_rfc2822(t).ok())
            .map(|d| d.with_timezone(&chrono::Utc));
        if resp.status().is_server_error() {
            return Err(Fallo::Red(format!("El servidor respondió {}", resp.status())));
        }
        Ok((ms, hora))
    }

    /// Informa cómo terminó una orden del panel.
    pub async fn resultado(&self, c: &Config, token: &str, id: i64, ok: bool, texto: &str) -> Result<(), Fallo> {
        self.rpc(c, "faro_comando_resultado", json!({ "p_token": token, "p_id": id, "p_ok": ok, "p_resultado": texto }))
            .await
            .map(|_| ())
    }
}
