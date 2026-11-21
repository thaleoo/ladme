//! Qué debe mostrar Faro en cada instante. Es una función pura: recibe lo último
//! que dijo el servidor, la hora corregida y la actividad del PC, y devuelve la
//! vista. Sin conexión aplica las mismas reglas sobre la última copia conocida
//! (una reserva sigue valiendo hasta su fin; un equipo sin reserva sigue sin ella).

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

/// Respuesta de `faro_estado` (lo que se guarda como copia sin conexión).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Remoto {
    pub ahora: DateTime<Utc>,
    pub equipo: EquipoRemoto,
    pub modo: Modo,
    pub desbloqueo_hasta: Option<DateTime<Utc>>,
    pub actual: Option<Ocupacion>,
    pub siguiente: Option<Siguiente>,
    pub politicas: Politicas,
    pub clave: Option<Clave>,
    /// Desde la 0008: secreto del QR de llegada, canal, órdenes pendientes y anuncio.
    #[serde(default)]
    pub qr: Option<QrLlegada>,
    #[serde(default)]
    pub canal: Option<String>,
    #[serde(default, skip_serializing)]
    pub comandos: Vec<Comando>,
    #[serde(default)]
    pub anuncio: Option<Anuncio>,
    /// Desde la 0011: uso compartido en curso y personas esperando un equipo.
    #[serde(default)]
    pub compartido: Option<Compartido>,
    #[serde(default)]
    pub espera: i64,
}

/// Otra persona dejó un proceso corriendo y permite usar el equipo sin cerrar estos programas.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Compartido {
    pub hasta: DateTime<Utc>,
    #[serde(default)]
    pub protegidos: Vec<String>,
    #[serde(default)]
    pub nota: Option<String>,
    #[serde(default)]
    pub titular: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct QrLlegada {
    pub secreto: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Comando {
    pub id: i64,
    pub tipo: String,
    #[serde(default)]
    pub datos: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Anuncio {
    pub id: i64,
    pub texto: String,
    pub hasta: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EquipoRemoto {
    pub codigo: String,
    pub nombre: String,
    pub estado: String,
    #[serde(default)]
    pub sistema: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Modo {
    Observar,
    Avisar,
    Bloquear,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Ocupacion {
    pub tipo: String, // "reserva" | "bloqueo"
    pub inicio: DateTime<Utc>,
    pub fin: DateTime<Utc>,
    pub titular: Option<String>,
    #[serde(default)]
    pub desatendido: bool,
    pub mensaje: Option<String>,
    pub motivo: Option<String>,
    #[serde(default)]
    pub llegada: bool,
    /// Hasta cuándo puede registrar la llegada sin que cuente como inasistencia (desde 0014).
    #[serde(default)]
    pub llegada_hasta: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Siguiente {
    pub tipo: String,
    pub inicio: DateTime<Utc>,
    pub fin: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Politicas {
    pub aviso_min: i64,
    pub gracia_min: i64,
    pub desatendido_min: i64,
    #[serde(default)]
    pub llegada_modo: i64,
    #[serde(default = "uno")]
    pub sesion_limpia: i64,
}

fn uno() -> i64 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Clave {
    pub sal: String,
    pub hash: String,
    pub iteraciones: u32,
}

/// Lo que Faro recuerda localmente entre latidos.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Memoria {
    /// Fin de la última reserva vista (o el momento en que desapareció, si se liberó antes).
    pub fin_reciente: Option<DateTime<Utc>>,
    /// Hasta cuándo vale un desbloqueo hecho con la clave de emergencia.
    pub emergencia_hasta: Option<DateTime<Utc>>,
    /// Inicio de la última reserva vista (para ofrecer borrar solo los archivos de esa sesión).
    #[serde(default)]
    pub inicio_reciente: Option<DateTime<Utc>>,
}

pub struct Entrada<'a> {
    pub remoto: Option<&'a Remoto>,
    pub ahora: DateTime<Utc>,
    pub en_linea: bool,
    pub inactivo_seg: Option<u64>,
    pub memoria: &'a Memoria,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Estado {
    Conectando,
    Reservado,
    PorTerminar,
    Gracia,
    Libre,
    LibreEnUso,
    Bloqueado,
    Desbloqueado,
    /// Uso compartido: se puede usar el equipo sin cerrar los programas protegidos.
    Compartido,
    Mantenimiento,
    Ocupado,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Pantalla {
    Ninguna,
    Bloqueo,
    Desatendido,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Vista {
    pub estado: Estado,
    pub pantalla: Pantalla,
    pub modo: Option<Modo>,
    pub equipo: Option<String>,
    pub sistema: Option<String>,
    pub titulo: String,
    pub detalle: String,
    /// Momento al que apunta la cuenta regresiva de la isla, si hay una.
    pub cuenta_hasta: Option<DateTime<Utc>>,
    /// Inicio de la ocupación vigente (para la barra de progreso).
    pub desde: Option<DateTime<Utc>>,
    /// La isla debe abrirse sola para llamar la atención.
    pub insistir: bool,
    pub en_linea: bool,
    /// Ruta de la PWA a la que apunta el QR (reservar, ficha del equipo…).
    pub ruta_qr: String,
    pub siguiente: Option<DateTime<Utc>>,
    pub titular: Option<String>,
    pub mensaje: Option<String>,
    /// Hay una reserva sin llegada registrada y la llegada se hace con el QR de la isla.
    pub llegada_pendiente: bool,
    /// Límite para registrar la llegada (se muestra con la llegada pendiente).
    pub llegada_hasta: Option<DateTime<Utc>>,
    pub anuncio: Option<String>,
    /// Ofrecer borrar los archivos creados desde este momento (la sesión que terminó).
    pub limpieza_desde: Option<DateTime<Utc>>,
    /// Uso compartido en curso (con o sin invitado): qué no se debe cerrar.
    pub compartido: Option<Compartido>,
    /// Personas esperando un equipo libre.
    pub espera: i64,
}

/// «Windows Windows 11 Pro» → «Windows 11 Pro»: el tipo de sistema y la versión a veces traen la misma palabra.
fn sin_repetir(s: &str) -> String {
    let palabras: Vec<&str> = s.split_whitespace().collect();
    match palabras.as_slice() {
        [a, b, ..] if a.eq_ignore_ascii_case(b) => palabras[1..].join(" "),
        _ => palabras.join(" "),
    }
}

const USO_RECIENTE_SEG: u64 = 120;

fn es_reserva(o: &Ocupacion) -> bool {
    o.tipo == "reserva"
}

pub fn decidir(e: &Entrada) -> Vista {
    let Some(r) = e.remoto else {
        return Vista {
            estado: Estado::Conectando,
            pantalla: Pantalla::Ninguna,
            modo: None,
            equipo: None,
            sistema: None,
            titulo: "Conectando con LADME".into(),
            detalle: "Faro está buscando el servidor.".into(),
            cuenta_hasta: None,
            desde: None,
            insistir: false,
            en_linea: e.en_linea,
            ruta_qr: "/".into(),
            siguiente: None,
            titular: None,
            mensaje: None,
            llegada_pendiente: false,
            llegada_hasta: None,
            anuncio: None,
            limpieza_desde: None,
            compartido: None,
            espera: 0,
        };
    };

    let ahora = e.ahora;
    let codigo = r.equipo.codigo.clone();
    let bloquea = r.modo == Modo::Bloquear;
    let en_uso = e.inactivo_seg.map(|s| s < USO_RECIENTE_SEG).unwrap_or(false);
    let ruta_reservar = format!("/reservar?equipo={codigo}");
    let ruta_ficha = format!("/equipo/{codigo}");
    let siguiente = r.siguiente.as_ref().filter(|s| s.inicio > ahora).map(|s| s.inicio);

    let mut v = Vista {
        estado: Estado::Libre,
        pantalla: Pantalla::Ninguna,
        modo: Some(r.modo),
        equipo: Some(codigo.clone()),
        sistema: Some(sin_repetir(&r.equipo.sistema)).filter(|s| !s.is_empty()),
        titulo: String::new(),
        detalle: String::new(),
        cuenta_hasta: None,
        desde: None,
        insistir: false,
        en_linea: e.en_linea,
        ruta_qr: ruta_reservar.clone(),
        siguiente,
        titular: None,
        mensaje: None,
        llegada_pendiente: false,
        llegada_hasta: None,
        anuncio: r.anuncio.as_ref().filter(|a| a.hasta > ahora).map(|a| a.texto.clone()),
        limpieza_desde: None,
        compartido: r.compartido.clone().filter(|c| c.hasta > ahora),
        espera: r.espera.max(0),
    };

    // La ocupación vigente según la copia (sin conexión, una reserva vale hasta su fin).
    let actual = r.actual.as_ref().filter(|o| o.inicio <= ahora && o.fin > ahora);

    // 1) Desbloqueo del personal (PWA) o con la clave de emergencia: manda sobre todo.
    let desbloqueo = [r.desbloqueo_hasta, e.memoria.emergencia_hasta]
        .into_iter()
        .flatten()
        .filter(|h| *h > ahora)
        .max();
    if let Some(hasta) = desbloqueo {
        if actual.map(es_reserva) != Some(true) {
            v.estado = Estado::Desbloqueado;
            match actual.and_then(|o| o.motivo.as_deref()).and_then(|m| m.strip_prefix("Clase · ")) {
                // Modo clase: el equipo está apartado para la clase y libre para usarlo.
                Some(clase) => {
                    v.titulo = "Clase en curso".into();
                    v.detalle = format!("{clase} · uso libre durante la clase.");
                }
                None => {
                    v.titulo = "Desbloqueado por el personal".into();
                    v.detalle = "Uso libre temporal autorizado por el laboratorio.".into();
                }
            }
            v.cuenta_hasta = Some(hasta);
            return v;
        }
    }

    // 1b) Uso compartido sin nadie más: el equipo se puede usar sin cerrar los programas protegidos.
    if actual.is_none() {
        if let Some(c) = v.compartido.clone() {
            v.estado = Estado::Compartido;
            v.titulo = "Uso compartido".into();
            // Lo que no se debe cerrar va en el aviso «protegido» de la isla; aquí solo la idea.
            v.detalle = if c.protegidos.is_empty() {
                "Puedes usar este equipo sin cerrar los programas abiertos.".into()
            } else {
                format!("Puedes usar este equipo sin cerrar {}.", c.protegidos.join(", "))
            };
            v.titular = c.titular.clone();
            v.mensaje = c.nota.clone();
            v.cuenta_hasta = Some(c.hasta);
            return v;
        }
    }

    // 2) Equipo en mantenimiento o fuera de servicio.
    if r.equipo.estado != "activo" && actual.map(es_reserva) != Some(true) {
        v.estado = Estado::Mantenimiento;
        v.titulo = if r.equipo.estado == "mantenimiento" { "En mantenimiento" } else { "Fuera de servicio" }.into();
        v.detalle = "El laboratorio sacó este equipo de servicio por ahora.".into();
        v.ruta_qr = "/".into();
        if bloquea {
            v.pantalla = Pantalla::Bloqueo;
        }
        return v;
    }

    match actual {
        // 3) Bloqueo del laboratorio (clase, evento, mantenimiento programado).
        Some(o) if !es_reserva(o) => {
            v.estado = Estado::Ocupado;
            v.titulo = "Bloqueado por el laboratorio".into();
            v.detalle = o.motivo.clone().unwrap_or_else(|| "Reservado para una actividad del laboratorio.".into());
            v.cuenta_hasta = Some(o.fin);
            v.desde = Some(o.inicio);
            v.ruta_qr = "/".into();
            if bloquea {
                v.pantalla = Pantalla::Bloqueo;
            }
            v
        }
        // 4) Reserva vigente.
        Some(o) => {
            let restante = o.fin - ahora;
            let aviso = Duration::minutes(r.politicas.aviso_min.max(1));
            v.titular = o.titular.clone();
            v.mensaje = o.mensaje.clone();
            v.llegada_pendiente = !o.llegada && r.politicas.llegada_modo == 2 && r.qr.is_some();
            v.llegada_hasta = if v.llegada_pendiente { o.llegada_hasta.filter(|h| *h > ahora) } else { None };
            v.cuenta_hasta = Some(o.fin);
            v.desde = Some(o.inicio);
            v.ruta_qr = ruta_ficha;
            if restante <= aviso {
                v.estado = Estado::PorTerminar;
                v.titulo = "Tu reserva está por terminar".into();
                v.detalle = match (bloquea, siguiente.filter(|s| *s <= o.fin + Duration::minutes(5))) {
                    (_, Some(_)) => "Después sigue otra reserva: guarda tu trabajo.".into(),
                    (true, None) => "Guarda tu trabajo o extiende desde tu celular; luego el equipo se bloquea.".into(),
                    (false, None) => "Extiende desde tu celular si necesitas más tiempo.".into(),
                };
                v.insistir = r.modo != Modo::Observar || restante <= Duration::minutes(2);
            } else {
                v.estado = Estado::Reservado;
                v.titulo = match &o.titular {
                    Some(n) => format!("Reservado por {n}"),
                    None => "Reservado".into(),
                };
                v.detalle = if o.desatendido { "Proceso desatendido en curso.".into() } else { String::new() };
            }
            let quieto = e.inactivo_seg.map(|s| s >= (r.politicas.desatendido_min.max(1) * 60) as u64).unwrap_or(false);
            if o.desatendido && quieto && r.modo != Modo::Observar {
                v.pantalla = Pantalla::Desatendido;
            }
            v
        }
        // 5) Sin ocupación vigente.
        None => {
            // Recién terminó una reserva: ofrecer borrar los archivos de esa sesión (15 min).
            if r.politicas.sesion_limpia == 1 && v.compartido.is_none() {
                if let (Some(fin), Some(ini)) = (e.memoria.fin_reciente, e.memoria.inicio_reciente) {
                    if fin <= ahora && ahora < fin + Duration::minutes(15) {
                        v.limpieza_desde = Some(ini);
                    }
                }
            }
            let gracia = Duration::minutes(r.politicas.gracia_min.max(0));
            if let Some(fin) = e.memoria.fin_reciente.filter(|f| *f <= ahora && ahora < *f + gracia) {
                v.estado = Estado::Gracia;
                v.titulo = "Tu reserva terminó".into();
                v.detalle = if bloquea {
                    "Guarda tu trabajo: el equipo se bloquea en unos minutos. Puedes reservar de nuevo.".into()
                } else {
                    "Libera el equipo o reserva de nuevo si lo sigues usando.".into()
                };
                v.cuenta_hasta = Some(fin + gracia);
                v.insistir = r.modo != Modo::Observar;
                return v;
            }
            v.detalle = match siguiente {
                Some(_) => "Hay una reserva más tarde.".into(),
                None => "Sin reservas en las próximas horas.".into(),
            };
            match r.modo {
                Modo::Bloquear => {
                    v.estado = Estado::Bloqueado;
                    v.pantalla = Pantalla::Bloqueo;
                    v.titulo = format!("{codigo} no tiene una reserva vigente");
                    v.detalle = "Escanea el código para reservarlo desde tu celular. Se desbloquea solo en unos segundos.".into();
                }
                Modo::Avisar if en_uso => {
                    v.estado = Estado::LibreEnUso;
                    v.titulo = "Este equipo no está reservado".into();
                    v.detalle = "Resérvalo para que nadie más lo tome mientras trabajas.".into();
                    v.insistir = true;
                }
                _ => {
                    v.estado = Estado::Libre;
                    v.titulo = "Disponible".into();
                }
            }
            v.cuenta_hasta = siguiente;
            v
        }
    }
}

/// Actualiza la memoria local con lo que se acaba de ver.
pub fn recordar(m: &mut Memoria, antes: Option<&Remoto>, ahora_remoto: Option<&Remoto>, ahora: DateTime<Utc>) {
    let reserva = |r: Option<&Remoto>| r.and_then(|r| r.actual.clone()).filter(es_reserva);
    match (reserva(antes), reserva(ahora_remoto)) {
        // La reserva desapareció (terminó o se liberó antes): la gracia cuenta desde ese momento.
        (Some(a), None) => m.fin_reciente = Some(a.fin.min(ahora)),
        (_, Some(b)) => {
            m.fin_reciente = Some(b.fin);
            m.inicio_reciente = Some(b.inicio);
        }
        _ => {}
    }
}

#[cfg(test)]
mod pruebas {
    use super::*;

    fn t(min: i64) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-11-17T20:00:00Z").unwrap().with_timezone(&Utc) + Duration::minutes(min)
    }

    fn remoto(modo: Modo, actual: Option<Ocupacion>) -> Remoto {
        Remoto {
            ahora: t(0),
            equipo: EquipoRemoto { codigo: "UNAL-05".into(), nombre: "HP Z1".into(), estado: "activo".into(), sistema: "Windows 11 Pro".into() },
            modo,
            desbloqueo_hasta: None,
            actual,
            siguiente: None,
            politicas: Politicas { aviso_min: 10, gracia_min: 3, desatendido_min: 10, llegada_modo: 0, sesion_limpia: 1 },
            clave: None,
            qr: None,
            canal: None,
            comandos: vec![],
            anuncio: None,
            compartido: None,
            espera: 0,
        }
    }

    fn reserva(desde: i64, hasta: i64) -> Ocupacion {
        Ocupacion { tipo: "reserva".into(), inicio: t(desde), fin: t(hasta), titular: Some("Ana".into()),
                    desatendido: false, mensaje: None, motivo: None, llegada: true, llegada_hasta: None }
    }

    fn ver(r: &Remoto, min: i64, inactivo: Option<u64>, m: &Memoria) -> Vista {
        decidir(&Entrada { remoto: Some(r), ahora: t(min), en_linea: true, inactivo_seg: inactivo, memoria: m })
    }

    #[test]
    fn sin_reserva_segun_el_modo() {
        let m = Memoria::default();
        assert_eq!(ver(&remoto(Modo::Observar, None), 0, Some(5), &m).estado, Estado::Libre);
        let avisar = ver(&remoto(Modo::Avisar, None), 0, Some(5), &m);
        assert_eq!((avisar.estado, avisar.insistir, avisar.pantalla), (Estado::LibreEnUso, true, Pantalla::Ninguna));
        assert_eq!(ver(&remoto(Modo::Avisar, None), 0, Some(900), &m).estado, Estado::Libre);
        let b = ver(&remoto(Modo::Bloquear, None), 0, None, &m);
        assert_eq!((b.estado, b.pantalla), (Estado::Bloqueado, Pantalla::Bloqueo));
        assert_eq!(b.ruta_qr, "/reservar?equipo=UNAL-05");
    }

    #[test]
    fn reserva_vigente_y_por_terminar() {
        let m = Memoria::default();
        let r = remoto(Modo::Bloquear, Some(reserva(-30, 60)));
        let v = ver(&r, 0, Some(1), &m);
        assert_eq!((v.estado, v.pantalla, v.titulo.as_str()), (Estado::Reservado, Pantalla::Ninguna, "Reservado por Ana"));
        let v = ver(&r, 52, Some(1), &m);
        assert_eq!((v.estado, v.insistir), (Estado::PorTerminar, true));
        // Sin conexión la reserva conocida sigue valiendo hasta su fin, y después bloquea.
        let off = decidir(&Entrada { remoto: Some(&r), ahora: t(59), en_linea: false, inactivo_seg: None, memoria: &m });
        assert_eq!(off.pantalla, Pantalla::Ninguna);
        let off = decidir(&Entrada { remoto: Some(&r), ahora: t(61), en_linea: false, inactivo_seg: None, memoria: &m });
        assert_eq!(off.pantalla, Pantalla::Bloqueo);
    }

    #[test]
    fn gracia_al_terminar() {
        let antes = remoto(Modo::Bloquear, Some(reserva(-30, 0)));
        let despues = remoto(Modo::Bloquear, None);
        let mut m = Memoria::default();
        recordar(&mut m, Some(&antes), Some(&despues), t(0));
        let v = ver(&despues, 1, Some(1), &m);
        assert_eq!((v.estado, v.pantalla), (Estado::Gracia, Pantalla::Ninguna));
        assert_eq!(v.cuenta_hasta, Some(t(3)));
        assert_eq!(ver(&despues, 4, Some(1), &m).pantalla, Pantalla::Bloqueo);
    }

    #[test]
    fn liberar_antes_cuenta_la_gracia_desde_ese_momento() {
        let antes = remoto(Modo::Bloquear, Some(reserva(-30, 120)));
        let despues = remoto(Modo::Bloquear, None);
        let mut m = Memoria::default();
        recordar(&mut m, Some(&antes), Some(&despues), t(10));
        assert_eq!(ver(&despues, 11, None, &m).estado, Estado::Gracia);
        assert_eq!(ver(&despues, 14, None, &m).estado, Estado::Bloqueado);
    }

    #[test]
    fn desbloqueos_y_mantenimiento() {
        let mut r = remoto(Modo::Bloquear, None);
        r.desbloqueo_hasta = Some(t(30));
        let m = Memoria::default();
        assert_eq!(ver(&r, 0, None, &m).estado, Estado::Desbloqueado);
        assert_eq!(ver(&r, 31, None, &m).estado, Estado::Bloqueado);
        let mut clase = reserva(-5, 55);
        clase.tipo = "bloqueo".into();
        clase.motivo = Some("Clase · Estadística I".into());
        let mut rc = remoto(Modo::Bloquear, Some(clase));
        rc.desbloqueo_hasta = Some(t(55));
        let v = ver(&rc, 0, None, &Memoria::default());
        assert_eq!((v.estado, v.pantalla, v.titulo.as_str()), (Estado::Desbloqueado, Pantalla::Ninguna, "Clase en curso"));
        let m = Memoria { emergencia_hasta: Some(t(60)), ..Default::default() };
        assert_eq!(ver(&remoto(Modo::Bloquear, None), 45, None, &m).pantalla, Pantalla::Ninguna);

        let mut r = remoto(Modo::Bloquear, None);
        r.equipo.estado = "mantenimiento".into();
        let v = ver(&r, 0, None, &Memoria::default());
        assert_eq!((v.estado, v.pantalla), (Estado::Mantenimiento, Pantalla::Bloqueo));
        r.modo = Modo::Avisar;
        assert_eq!(ver(&r, 0, None, &Memoria::default()).pantalla, Pantalla::Ninguna);
    }

    #[test]
    fn bloqueo_del_laboratorio_y_desatendido() {
        let mut b = reserva(-10, 50);
        b.tipo = "bloqueo".into();
        b.motivo = Some("Clase de Estadística".into());
        let v = ver(&remoto(Modo::Bloquear, Some(b)), 0, None, &Memoria::default());
        assert_eq!((v.estado, v.pantalla, v.detalle.as_str()), (Estado::Ocupado, Pantalla::Bloqueo, "Clase de Estadística"));

        let mut d = reserva(-60, 600);
        d.desatendido = true;
        let r = remoto(Modo::Avisar, Some(d));
        assert_eq!(ver(&r, 0, Some(700), &Memoria::default()).pantalla, Pantalla::Desatendido);
        assert_eq!(ver(&r, 0, Some(30), &Memoria::default()).pantalla, Pantalla::Ninguna);
    }

    #[test]
    fn llegada_por_qr_y_sesion_limpia() {
        let mut r = remoto(Modo::Observar, Some(Ocupacion { llegada: false, ..reserva(-5, 60) }));
        assert!(!ver(&r, 0, None, &Memoria::default()).llegada_pendiente);
        r.politicas.llegada_modo = 2;
        if let Some(o) = r.actual.as_mut() {
            o.llegada_hasta = Some(o.inicio + Duration::minutes(30));
        }
        r.qr = Some(QrLlegada { secreto: "x".into() });
        let vl = ver(&r, 0, None, &Memoria::default());
        assert!(vl.llegada_pendiente && vl.llegada_hasta.is_some());

        let antes = remoto(Modo::Observar, Some(reserva(-60, 0)));
        let despues = remoto(Modo::Observar, None);
        let mut m = Memoria::default();
        recordar(&mut m, Some(&antes), Some(&antes), t(-1));
        recordar(&mut m, Some(&antes), Some(&despues), t(0));
        assert_eq!(ver(&despues, 5, None, &m).limpieza_desde, Some(t(-60)));
        assert_eq!(ver(&despues, 20, None, &m).limpieza_desde, None);
    }

    #[test]
    fn uso_compartido_no_bloquea() {
        let mut r = remoto(Modo::Bloquear, None);
        r.compartido = Some(Compartido { hasta: t(120), protegidos: vec!["RStudio".into()], nota: None, titular: Some("Ana".into()) });
        let v = ver(&r, 0, Some(5), &Memoria::default());
        assert_eq!(v.estado, Estado::Compartido);
        assert_eq!(v.pantalla, Pantalla::Ninguna);
        assert!(v.detalle.contains("RStudio"));
        // Con un invitado, la vista es la de su reserva y conserva el aviso de lo protegido.
        let mut g = remoto(Modo::Bloquear, Some(reserva(-5, 60)));
        g.compartido = r.compartido.clone();
        let v = ver(&g, 0, Some(5), &Memoria::default());
        assert_eq!(v.estado, Estado::Reservado);
        assert!(v.compartido.is_some());
    }

    #[test]
    fn sistema_sin_palabra_repetida() {
        assert_eq!(super::sin_repetir("Windows Windows 11 Pro"), "Windows 11 Pro");
        assert_eq!(super::sin_repetir("Linux Fedora 43"), "Linux Fedora 43");
        assert_eq!(super::sin_repetir(""), "");
    }

    #[test]
    fn la_respuesta_del_servidor_se_lee() {
        // Respuesta real de faro_estado en PostgreSQL (rol anon), con una reserva desatendida.
        let json = r#"{"modo": "bloquear", "ahora": "2026-11-17T21:30:10.3803-05:00", "clave": {"sal": "RWXXWVJG8CK88X2N", "hash": "ca84d6dfb8221da7cd28699e62712adcddc6c6804f690dc5f9f2441ea6d55f58", "iteraciones": 20000}, "actual": {"fin": "2026-11-17T22:20:10.375587-05:00", "tipo": "reserva", "inicio": "2026-11-17T21:20:10.375587-05:00", "motivo": null, "llegada": true, "mensaje": "Entrenando un modelo", "titular": "beto", "desatendido": true}, "equipo": {"codigo": "UNAL-15", "estado": "activo", "nombre": "Precision 3660", "sistema": ""}, "politicas": {"aviso_min": 10, "gracia_min": 3, "desatendido_min": 10}, "siguiente": null, "desbloqueo_hasta": null}"#;
        let r: Remoto = serde_json::from_str(json).unwrap();
        assert_eq!(r.modo, Modo::Bloquear);
        let o = r.actual.clone().unwrap();
        assert_eq!((o.titular.as_deref(), o.desatendido, o.llegada), (Some("beto"), true, true));
        assert!(r.clave.is_some());
        let v = decidir(&Entrada { remoto: Some(&r), ahora: r.ahora, en_linea: true, inactivo_seg: Some(700), memoria: &Memoria::default() });
        assert_eq!((v.estado, v.pantalla), (Estado::Reservado, Pantalla::Desatendido));
    }
}
