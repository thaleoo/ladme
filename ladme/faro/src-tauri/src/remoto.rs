//! La interfaz de la sesión cuando Faro corre como servicio del sistema: se conecta al socket del
//! servicio, muestra lo que este decide y le pide las acciones. Si el servicio no está (se reinicia,
//! se actualiza), no se muestra nada y se reintenta cada pocos segundos.

use crate::{atender, inactividad, registro, servicio, sin_nucleo, Senal};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::{mpsc, oneshot};

type Pendientes = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

#[derive(Clone)]
pub struct Remoto {
    salida: Arc<Mutex<Option<mpsc::UnboundedSender<String>>>>,
    pendientes: Pendientes,
    siguiente: Arc<AtomicU64>,
}

impl Remoto {
    pub fn nuevo() -> Self {
        Remoto { salida: Arc::new(Mutex::new(None)), pendientes: Arc::new(Mutex::new(HashMap::new())), siguiente: Arc::new(AtomicU64::new(1)) }
    }

    /// Pide una acción al servicio y espera la respuesta.
    pub async fn llamar(&self, nombre: &str, args: Value) -> Result<Value, String> {
        let id = self.siguiente.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pendientes.lock().unwrap().insert(id, tx);
        let enviado = self
            .salida
            .lock()
            .unwrap()
            .as_ref()
            .map(|s| s.send(json!({ "op": "pedir", "id": id, "nombre": nombre, "args": args }).to_string()).is_ok())
            .unwrap_or(false);
        if !enviado {
            self.pendientes.lock().unwrap().remove(&id);
            return Err("El servicio de Faro no responde. Intente de nuevo en un momento.".into());
        }
        // Las acciones con el servidor (reportar con diagnóstico) pueden tardar.
        match tokio::time::timeout(Duration::from_secs(60), rx).await {
            Ok(Ok(r)) => r,
            _ => {
                self.pendientes.lock().unwrap().remove(&id);
                Err("El servicio de Faro no respondió a tiempo.".into())
            }
        }
    }

    fn cortar(&self) {
        *self.salida.lock().unwrap() = None;
        for (_, tx) in self.pendientes.lock().unwrap().drain() {
            let _ = tx.send(Err("Se perdió la conexión con el servicio de Faro.".into()));
        }
    }
}

/// Conecta, atiende lo que llega y reconecta cuando se pierde la conexión.
pub async fn correr(app: AppHandle, r: Remoto) {
    let mut avisado = false;
    loop {
        match UnixStream::connect(servicio::SOCKET).await {
            Ok(con) => {
                registro::info("Conectada con el servicio de Faro");
                avisado = false;
                sesion(&app, &r, con).await;
                r.cortar();
                registro::aviso("Se perdió la conexión con el servicio de Faro");
            }
            Err(e) if !avisado => {
                registro::aviso(format!("No se pudo conectar con el servicio de Faro: {e}"));
                avisado = true;
            }
            Err(_) => {}
        }
        sin_nucleo(&app);
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
}

async fn sesion(app: &AppHandle, r: &Remoto, con: UnixStream) {
    let (lector, mut escritor) = con.into_split();
    let (tx, mut cola) = mpsc::unbounded_channel::<String>();
    *r.salida.lock().unwrap() = Some(tx.clone());

    let escribir = tokio::spawn(async move {
        while let Some(l) = cola.recv().await {
            if escritor.write_all(format!("{l}\n").as_bytes()).await.is_err() {
                break;
            }
        }
    });
    // Cada 2 s: sigo viva y hace cuánto no se toca el equipo en esta sesión.
    let latido = tokio::spawn(async move {
        loop {
            let inactivo = tokio::task::spawn_blocking(inactividad::segundos).await.ok().flatten();
            if tx.send(json!({ "op": "hola", "inactivo": inactivo }).to_string()).is_err() {
                break;
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    });

    let mut primero = true;
    let mut lineas = BufReader::new(lector).lines();
    while let Ok(Some(l)) = lineas.next_line().await {
        let Ok(m) = serde_json::from_str::<Value>(&l) else { continue };
        if let Some(id) = m["id"].as_u64() {
            if let Some(tx) = r.pendientes.lock().unwrap().remove(&id) {
                let _ = tx.send(if m["ok"].as_bool().unwrap_or(false) {
                    Ok(m["valor"].clone())
                } else {
                    Err(m["error"].as_str().unwrap_or("Error del servicio de Faro.").to_string())
                });
            }
            continue;
        }
        let Ok(s) = serde_json::from_value::<Senal>(m) else { continue };
        if primero {
            primero = false;
            if let Senal::Paquete(p) = &s {
                if !p["vinculado"].as_bool().unwrap_or(false) {
                    crate::abrir_vincular(app);
                }
            }
        }
        let app2 = app.clone();
        // Las ventanas se tocan desde el hilo principal.
        let _ = app.run_on_main_thread(move || atender(&app2, s));
    }
    latido.abort();
    escribir.abort();
}
