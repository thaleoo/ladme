// ============================================================================
// SISTEMA DE RESERVAS Y GESTIÓN DE COMPUTADORES - LADME (UNAL)
// Laboratorio de Aprendizaje de Datos y Modelado Estadístico
//
// Estado del código: P0 (seguridad) + P1-A (historial e identidad en enlaces)
//                    + P1-B1 (idempotencia) + P1-B2 (Estado de equipos)
//                    + N1/N2a (ficha de equipo por NFC/QR, contacto, mensaje de llegada)
//                    + P1-C (identidad de sesión) + N3 (reserva rápida, bloqueos de gestión, vista de ronda).
// ============================================================================

const ADMIN_EMAILS = [
  "josoriodi@unal.edu.co",
  "labdatos_paz@unal.edu.co"
];

// Rol laboratorista (staff). Puede ver el panel operativo y validar mantenimiento,
// pero no cambia roles ni políticas. Hoy las dos cuentas iniciales son admin.
const LAB_EMAILS = [
  "josoriodi@unal.edu.co",
  "labdatos_paz@unal.edu.co"
];

// Permisos finos (D-03: 3 roles + permiso). El rol se deriva del correo; el permiso
// se concede explícitamente. Para agregar un responsable técnico, añada su correo
// a "validar_mantenimiento" sin convertirlo en administrador.
const PERMISOS_POR_CORREO = {
  "josoriodi@unal.edu.co": ["validar_mantenimiento"],
  "labdatos_paz@unal.edu.co": ["validar_mantenimiento"]
};

// Cuenta con la que DEBE correr la aplicación. Los correos salen desde la cuenta que ejecuta el script
// (con "Ejecutar como: Yo" es quien hizo el ÚLTIMO despliegue). Si es otra, el panel admin muestra una alerta.
const CUENTA_REMITENTE = "labdatos_paz@unal.edu.co";
const NOMBRE_REMITENTE = "LADME - Laboratorio de Datos UNAL";

const HOJA_RESERVAS = "Reservas_LADME";
const HOJA_COMPUTADORES = "Computadores_LADME";
const HOJA_HISTORIAL = "Reservas_HISTORIAL";
const COL_ID_SOLICITUD = 16; // columna P
const COL_DESATENDIDO = 17;  // columna Q: "Sí" si dejó un proceso ejecutándose sin estar presente
const COL_MENSAJE = 18;      // columna R: mensaje corto para quien llegue al equipo
const LARGO_MAX_MENSAJE = 140;
const HOJA_CONTACTOS = "Reservas_CONTACTOS";
const ENCABEZADOS_CONTACTOS = ["Fecha", "Solicitante", "Equipo", "ID Reserva", "Titular (correo)", "Mensaje"];
const CONTACTO_ESPERA_SEG = 900; // un mismo solicitante puede escribir al mismo equipo cada 15 min
const HOJA_BLOQUEOS = "Bloqueos_LADME";
const ENCABEZADOS_BLOQUEOS = ["ID Bloqueo", "Equipo", "Desde", "Hasta", "Motivo", "Creado por", "Fecha creación", "Estado", "Cancelado por", "Fecha cancelación"];
const DURACIONES_RAPIDAS_MIN = [60, 120, 240, 480, 720, 1440]; // reserva rápida: 1, 2, 4, 8, 12 y 24 horas

// Columnas nuevas de Reservas_LADME (S..V). Se crean solas en la primera reserva.
const COL_ESTADO = 19;                 // S: Activa | Cancelada | Finalizada
const COL_FECHA_CANCELACION = 20;      // T
const COL_MOTIVO_CANCELACION = 21;     // U
const COL_EXTENSIONES = 22;            // V: contador de extensiones usadas
const ENCABEZADOS_RESERVAS_EXTRA = [
  [COL_ESTADO, "Estado"],
  [COL_FECHA_CANCELACION, "Fecha cancelación"],
  [COL_MOTIVO_CANCELACION, "Motivo cancelación"],
  [COL_EXTENSIONES, "Extensiones"]
];

// Política de reservas (D-02 confirmada): base 168 h + una extensión de hasta 24 h.
const DURACION_MAX_HORAS = 168;
const EXTENSION_MAX_HORAS = 24;
const DURACION_MAX_TOTAL_HORAS = 192;
const EXTENSIONES_MAX = 1;
const MAX_RESERVAS_ACTIVAS_USUARIO = 0; // opcional: 0 = sin límite (recomendado al inicio)

// Interruptor de emergencia: poner en false desactiva SOLO la comprobación de
// identidad en los enlaces del correo (el historial sigue funcionando).
const EXIGIR_IDENTIDAD_EN_ENLACES = true;

const MENSAJE_ENLACE_NO_AUTORIZADO =
  "Este enlace solo puede usarlo la persona que hizo la reserva. Ábralo iniciando sesión con su cuenta " +
  "institucional @unal.edu.co (la misma con la que se registró la reserva). Si cree que es un error, " +
  "contacte a la administración del laboratorio.";

const ENCABEZADOS_HISTORIAL = [
  "Fecha Acción", "Acción", "Actor", "Motivo",
  "Marca Temporal", "Tipo de Usuario", "Nombre", "Cédula", "Correo",
  "Programa Académico", "Matrícula", "Fecha Inicio", "Hora Inicio",
  "Fecha Fin", "Hora Fin", "Computador(es) Reservado(s)",
  "Tipo de Actividad", "Detalles / Tutor / Descripción", "ID Reserva"
];

const PALETA_ACTIVIDADES = {
  "Docencia": "#2b6cb0",
  "Trabajo de grado": "#319795",
  "PAE": "#dd6b20",
  "Investigación": "#805ad5",
  "Semilleros": "#2f855a",
  "Default": "#718096"
};

const ACTIVIDADES_VALIDAS = ["Docencia", "Investigación", "PAE", "Semilleros", "Trabajo de grado", "Otro"];
const TIPOS_USUARIO_VALIDOS = ["Estudiante", "Docente/Investigador"];
const LOCK_ESPERA_MS = 15000;

// Valores de referencia de la columna Estado (la regla real está en esEstadoReservable_).
const ESTADOS_EQUIPO = ["Activo", "En mantenimiento", "Fuera de servicio"];

// ============================================================================
// HELPERS DE SEGURIDAD Y VALIDACIÓN
// ============================================================================

/** Escapa texto para insertarlo en HTML (cuerpo o atributos). */
function escHtml_(v) {
  return String(v === null || v === undefined ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Copia superficial con todos los textos (y arrays de textos) escapados. */
function escaparCamposHtml_(obj) {
  var out = {};
  Object.keys(obj || {}).forEach(function (k) {
    var v = obj[k];
    if (typeof v === "string") out[k] = escHtml_(v);
    else if (Array.isArray(v)) out[k] = v.map(function (x) { return typeof x === "string" ? escHtml_(x) : x; });
    else out[k] = v;
  });
  return out;
}

/** Correo del usuario que abre la app. SIN fallback al dueño del script. */
function obtenerEmailActivo_() {
  try {
    var e = Session.getActiveUser().getEmail();
    return e ? e.toLowerCase().trim() : "";
  } catch (err) {
    return "";
  }
}

function esAdminActual_() {
  var email = obtenerEmailActivo_();
  if (!email) return false; // falla cerrada
  return ADMIN_EMAILS.some(function (a) { return a.toLowerCase().trim() === email; });
}

/** Úsese como primera línea de toda función servidor que exponga datos o acciones de administrador. */
function requireAdmin_() {
  if (!esAdminActual_()) throw new Error("No autorizado.");
}

/** ¿La sesión pertenece al personal del laboratorio (admin o laboratorista)? */
function esLaboratoristaActual_() {
  var email = obtenerEmailActivo_();
  if (!email) return false;
  if (esAdminActual_()) return true;
  return LAB_EMAILS.some(function (a) { return a.toLowerCase().trim() === email; });
}

/** Permisos finos por correo (p. ej. "validar_mantenimiento"). */
function permisosActuales_() {
  var email = obtenerEmailActivo_();
  if (!email) return [];
  return (PERMISOS_POR_CORREO[email] || []).slice();
}

function tienePermiso_(permiso) {
  if (esAdminActual_()) return true; // el admin puede todo
  return permisosActuales_().indexOf(String(permiso)) !== -1;
}

function requirePermiso_(permiso) {
  if (!tienePermiso_(permiso)) throw new Error("No tiene el permiso requerido: " + permiso + ".");
}

/** Estado de una fila de Reservas_LADME. Vacío = Activa (compatibilidad con filas viejas). */
function estadoReserva_(row) {
  var e = row && row[COL_ESTADO - 1] ? row[COL_ESTADO - 1].toString().trim() : "";
  return e || "Activa";
}

function esReservaCancelada_(row) {
  return estadoReserva_(row).toLowerCase() === "cancelada";
}

/**
 * Igual que esReservaCancelada_, pero para filas leídas a partir de la columna H
 * (índice 8). Varias funciones de disponibilidad leen solo el tramo H..V por
 * rendimiento, y ahí la columna Estado queda en la posición COL_ESTADO - 8.
 */
function esCanceladaEnSliceH_(r) {
  var e = r[COL_ESTADO - 8] ? r[COL_ESTADO - 8].toString().trim().toLowerCase() : "";
  return e === "cancelada";
}

/**
 * Valida la política de duración base. Función pura.
 * Devuelve { ok, horas } o { ok:false, mensaje }.
 */
function validarPoliticaBase_(inicio, fin) {
  if (!(inicio instanceof Date) || !(fin instanceof Date) || isNaN(inicio.getTime()) || isNaN(fin.getTime())) {
    return { ok: false, mensaje: "Fecha u hora inválida." };
  }
  var horas = (fin.getTime() - inicio.getTime()) / 3600000;
  if (horas <= 0) return { ok: false, mensaje: "La fecha/hora de fin debe ser posterior a la de inicio." };
  if (horas > DURACION_MAX_HORAS) {
    return {
      ok: false,
      mensaje: "La reserva supera el máximo de " + DURACION_MAX_HORAS + " horas (7 días). " +
        "Puede reservar hasta 168 h y solicitar una única extensión de hasta 24 h."
    };
  }
  return { ok: true, horas: horas };
}

/**
 * Valida una extensión. Función pura.
 * - Solo una extensión por reserva.
 * - La extensión añadida no puede superar 24 h.
 * - El total (inicio original → nuevo fin) no puede superar 192 h.
 * El admin puede saltarse los topes, pero queda registrado en el historial.
 */
function validarPoliticaExtension_(inicio, finActual, nuevoFin, extensionesUsadas, esAdmin) {
  if (!(inicio instanceof Date) || !(finActual instanceof Date) || !(nuevoFin instanceof Date)) {
    return { ok: false, mensaje: "Fecha u hora inválida." };
  }
  var usadas = Number(extensionesUsadas) || 0;
  var horasAgregadas = (nuevoFin.getTime() - finActual.getTime()) / 3600000;
  var horasTotales = (nuevoFin.getTime() - inicio.getTime()) / 3600000;
  if (horasAgregadas <= 0) return { ok: false, mensaje: "El nuevo fin debe ser posterior al fin actual." };
  if (!esAdmin && usadas >= EXTENSIONES_MAX) {
    return { ok: false, mensaje: "Esta reserva ya usó su única extensión permitida." };
  }
  if (!esAdmin && horasAgregadas > EXTENSION_MAX_HORAS) {
    return { ok: false, mensaje: "La extensión máxima es de " + EXTENSION_MAX_HORAS + " horas." };
  }
  if (!esAdmin && horasTotales > DURACION_MAX_TOTAL_HORAS) {
    return { ok: false, mensaje: "La reserva no puede superar " + DURACION_MAX_TOTAL_HORAS + " horas en total (168 h + 24 h)." };
  }
  return { ok: true, horasAgregadas: horasAgregadas, horasTotales: horasTotales, usadas: usadas };
}

/** Cuenta reservas activas/futuras (no canceladas) del correo, excluyendo una fila si se indica. */
function contarReservasVigentes_(correo, excluirId) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_RESERVAS);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var ncol = Math.min(Math.max(COL_ESTADO, 15), sheet.getMaxColumns());
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, ncol).getValues();
  var ahora = new Date();
  var objetivo = String(correo || "").toLowerCase().trim();
  var total = 0;
  data.forEach(function (row) {
    if (esReservaCancelada_(row)) return;
    var dueno = row[4] ? row[4].toString().toLowerCase().trim() : "";
    if (dueno !== objetivo) return;
    if (excluirId && idDeFila_(row) === excluirId) return;
    var fin = new Date(Utilities.formatDate(new Date(row[9]), Session.getScriptTimeZone(), "yyyy-MM-dd") + "T" + formatHoraStr(row[10]) + ":00");
    if (fin > ahora) total++;
  });
  return total;
}

/** ID de una fila de Reservas_LADME (col. O, o el derivado del timestamp para filas antiguas sin ID). */
function idDeFila_(row) {
  var id = row[14] ? row[14].toString().trim() : "";
  if (!id && row[0] instanceof Date) id = "RES-" + row[0].getTime();
  return id;
}

/**
 * Valida y normaliza la solicitud de reserva. Función pura (no toca hojas).
 * Devuelve { ok:true, datos:{...limpios} } o { ok:false, mensaje:"..." }.
 */
function validarDatosReserva_(datos) {
  function fallo(m) { return { ok: false, mensaje: m }; }
  if (!datos || typeof datos !== "object") return fallo("Solicitud inválida.");

  var textos = {
    nombre: [1, 120], cedula: [1, 20], correo: [6, 120], programa: [1, 150],
    matricula: [1, 40], detalleActividad: [1, 800], tipoUsuario: [1, 40], tipoActividad: [1, 40]
  };
  var limpio = {};
  for (var campo in textos) {
    var v = datos[campo];
    if (typeof v !== "string") return fallo("Falta o es inválido el campo: " + campo + ".");
    v = v.trim();
    if (v.length < textos[campo][0]) return fallo("Falta el campo: " + campo + ".");
    if (v.length > textos[campo][1]) return fallo("El campo " + campo + " es demasiado largo.");
    limpio[campo] = v;
  }

  if (TIPOS_USUARIO_VALIDOS.indexOf(limpio.tipoUsuario) === -1) return fallo("Tipo de usuario inválido.");
  if (ACTIVIDADES_VALIDAS.indexOf(limpio.tipoActividad) === -1) return fallo("Tipo de actividad inválido.");

  limpio.correo = limpio.correo.toLowerCase();
  if (!/^[a-z0-9._%+-]+@unal\.edu\.co$/.test(limpio.correo)) {
    return fallo("Debe usar un correo institucional @unal.edu.co válido.");
  }

  var reFecha = /^\d{4}-\d{2}-\d{2}$/;
  var reHora = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!reFecha.test(String(datos.fechaInicio)) || !reFecha.test(String(datos.fechaFin))) return fallo("Formato de fecha inválido.");
  if (!reHora.test(String(datos.horaInicio)) || !reHora.test(String(datos.horaFin))) return fallo("Formato de hora inválido.");
  limpio.fechaInicio = String(datos.fechaInicio);
  limpio.horaInicio = String(datos.horaInicio);
  limpio.fechaFin = String(datos.fechaFin);
  limpio.horaFin = String(datos.horaFin);

  // Política D-02: la reserva base no puede superar 168 h (7 días).
  var inicioPolitica = new Date(limpio.fechaInicio + "T" + limpio.horaInicio + ":00");
  var finPolitica = new Date(limpio.fechaFin + "T" + limpio.horaFin + ":00");
  var politica = validarPoliticaBase_(inicioPolitica, finPolitica);
  if (!politica.ok) return fallo(politica.mensaje);

  if (!Array.isArray(datos.equipos) || datos.equipos.length === 0) return fallo("Debe seleccionar un equipo.");
  if (datos.equipos.length > 1) return fallo("Solo puede seleccionar un (1) equipo por reserva.");
  if (typeof datos.equipos[0] !== "string" || datos.equipos[0].length === 0 || datos.equipos[0].length > 200) {
    return fallo("Equipo inválido.");
  }
  limpio.equipos = [datos.equipos[0]];

  var idSol = (datos.idSolicitud === undefined || datos.idSolicitud === null || datos.idSolicitud === "") ? "" : String(datos.idSolicitud);
  if (idSol && !/^[A-Za-z0-9-]{16,64}$/.test(idSol)) return fallo("Identificador de solicitud inválido.");
  limpio.idSolicitud = idSol;

  // Campos opcionales (clientes viejos no los envían)
  if (datos.desatendido !== undefined && datos.desatendido !== null && typeof datos.desatendido !== "boolean") {
    return fallo("Valor inválido en 'proceso desatendido'.");
  }
  limpio.desatendido = datos.desatendido === true;
  var msg = (datos.mensaje === undefined || datos.mensaje === null) ? "" : datos.mensaje;
  if (typeof msg !== "string") return fallo("Mensaje inválido.");
  msg = msg.replace(/[\r\n\t]+/g, " ").trim();
  if (msg.length > LARGO_MAX_MENSAJE) return fallo("El mensaje para quien llegue admite máximo " + LARGO_MAX_MENSAJE + " caracteres.");
  limpio.mensaje = msg;

  return { ok: true, datos: limpio };
}

// ============================================================================
// PUNTO DE ENTRADA WEB
// ============================================================================

function doGet(e) {
  try {
    inicializarHojas_();
  } catch (err) {
    Logger.log("Error inicializando hojas: " + err.toString());
  }

  // Acciones de enlaces del correo (con doble confirmación)
  if (e && e.parameter && e.parameter.action && e.parameter.id) {
    var accion = String(e.parameter.action);
    var id = String(e.parameter.id);
    if ((accion !== "cancelar" && accion !== "liberar") || !/^RES-\d+$/.test(id)) {
      return generarPaginaRespuestaHtml_("Solicitud inválida", "El enlace no es válido o está incompleto.", false);
    }
    if (e.parameter.confirm === "true") {
      return procesarAccionEmail_(accion, id);
    } else {
      return generarPaginaConfirmacionHtml_(accion, id);
    }
  }

  // Entrada por NFC/QR: ?asset=UNAL-05 (solo se acepta un identificador con caracteres seguros)
  var activo = (e && e.parameter && e.parameter.asset) ? String(e.parameter.asset).trim() : "";
  if (!/^[A-Za-z0-9-]{3,20}$/.test(activo)) activo = "";

  var template = HtmlService.createTemplateFromFile('Index');
  template.activoInicial = activo;
  return template.evaluate()
      .setTitle('LADME - Control y Reserva de Computadores')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function inicializarHojas_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var sheetReservas = ss.getSheetByName(HOJA_RESERVAS);
  if (!sheetReservas) {
    sheetReservas = ss.insertSheet(HOJA_RESERVAS);
    sheetReservas.appendRow([
      "Marca Temporal", "Tipo de Usuario", "Nombre", "Cédula", "Correo",
      "Programa Académico", "Matrícula", "Fecha Inicio",
      "Hora Inicio", "Fecha Fin", "Hora Fin", "Computador(es) Reservado(s)",
      "Tipo de Actividad", "Detalles / Tutor / Descripción", "ID Reserva"
    ]);
    sheetReservas.getRange(1, 1, 1, 15).setFontWeight("bold").setBackground("#6d28d9").setFontColor("#FFFFFF");
    sheetReservas.setFrozenRows(1);
  }
  try { asegurarColumnasExtra_(sheetReservas); } catch (err) { Logger.log("No se pudieron asegurar columnas extra: " + err.toString()); }

  var sheetEquipos = ss.getSheetByName(HOJA_COMPUTADORES);
  if (!sheetEquipos) {
    sheetEquipos = ss.insertSheet(HOJA_COMPUTADORES);
    sheetEquipos.appendRow(["ID / Placa", "Nombre/Modelo", "Marca", "Ubicación", "Estado"]);
    sheetEquipos.getRange(1, 1, 1, 5).setFontWeight("bold").setBackground("#5b21b6").setFontColor("#FFFFFF");
    sheetEquipos.setFrozenRows(1);

    var mockData = [
      ["UNAL-1001", "Precision 3660", "Dell", "Sala LADME", "Activo"],
      ["UNAL-1002", "Precision 7920", "Dell", "Sala LADME", "Activo"],
      ["UNAL-1003", "Z1 G6", "HP", "Sala LADME", "Activo"],
      ["UNAL-1004", "Precision 3660", "Dell", "Sala LADME", "Activo"],
      ["UNAL-1005", "Z1 G6", "HP", "Sala LADME", "Activo"],
      ["UNAL-1006", "Precision 7920", "Dell", "Sala LADME", "Activo"]
    ];
    sheetEquipos.getRange(2, 1, mockData.length, 5).setValues(mockData);
  }
}

/** Cuenta con la que se está ejecutando la aplicación (la que envía los correos). */
function cuentaEjecucion_() {
  try { return String(Session.getEffectiveUser().getEmail() || "").toLowerCase().trim(); } catch (err) { return ""; }
}

function obtenerInfoUsuario() {
  var email = obtenerEmailActivo_();
  var info = {
    email: email || "Usuario Institucional",
    esAdmin: esAdminActual_(),
    esLaboratorista: esLaboratoristaActual_(),
    permisos: permisosActuales_()
  };
  if (info.esAdmin) {
    // Solo la administración ve con qué cuenta corre la app (de ahí salen los correos)
    var ejecuta = cuentaEjecucion_();
    info.ejecutaComo = ejecuta;
    info.remitenteIncorrecto = !!ejecuta && ejecuta !== CUENTA_REMITENTE.toLowerCase().trim();
  }
  return info;
}

// ============================================================================
// CATÁLOGO DE EQUIPOS Y DISPONIBILIDAD
// ============================================================================

/** ¿Un equipo con este Estado se puede reservar? Vacío o "Activo" sí; todo lo demás no. */
function esEstadoReservable_(estado) {
  var e = String(estado === null || estado === undefined ? "" : estado).trim().toLowerCase();
  return e === "" || e === "activo";
}

/**
 * Lee Computadores_LADME (columnas A..E) y devuelve [{ etiqueta, estado, reservable }].
 * La etiqueta se construye IGUAL que siempre: "[ID] Nombre (Marca)".
 */
function leerCatalogoEquipos_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_COMPUTADORES);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var ncol = Math.min(5, sheet.getMaxColumns());
  var datos = sheet.getRange(2, 1, sheet.getLastRow() - 1, ncol).getValues();
  var salida = [];
  datos.forEach(function (r) {
    var num = r[0] ? r[0].toString().trim() : "";
    var nombre = r[1] ? r[1].toString().trim() : "";
    var marca = r[2] ? r[2].toString().trim() : "";
    if (!nombre) return;
    var etiqueta = "[" + num + "] " + nombre;
    if (marca) etiqueta += " (" + marca + ")";
    var estado = (ncol >= 5 && r[4]) ? r[4].toString().trim() : "";
    salida.push({
      etiqueta: etiqueta, estado: estado, reservable: esEstadoReservable_(estado),
      id: num, nombre: nombre, marca: marca, ubicacion: (r[3] ? r[3].toString().trim() : "")
    });
  });
  return salida;
}

/**
 * Lista de etiquetas de equipos.
 *   obtenerListaEquipos()      -> TODOS (filtros del calendario y del panel)
 *   obtenerListaEquipos(true)  -> solo los RESERVABLES (la usa la disponibilidad)
 */
function obtenerListaEquipos(soloReservables) {
  try {
    return leerCatalogoEquipos_()
      .filter(function (e) { return !soloReservables || e.reservable; })
      .map(function (e) { return e.etiqueta; });
  } catch (e) {
    return [];
  }
}

function obtenerEquiposDisponibles(fechaInicio, horaInicio, fechaFin, horaFin) {
  var todosLosEquipos = obtenerListaEquipos(true);
  if (todosLosEquipos.length === 0) return [];
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetReservas = ss.getSheetByName(HOJA_RESERVAS);

  var reqInicio = new Date(fechaInicio + "T" + horaInicio + ":00");
  var reqFin = new Date(fechaFin + "T" + horaFin + ":00");
  var equiposOcupados = [];

  if (sheetReservas && sheetReservas.getLastRow() >= 2) {
    var anchoReservas = Math.max(5, Math.min(COL_EXTENSIONES, sheetReservas.getMaxColumns()) - 7);
    var reservas = sheetReservas.getRange(2, 8, sheetReservas.getLastRow() - 1, anchoReservas).getValues();
    reservas.forEach(function(r) {
      if (esCanceladaEnSliceH_(r)) return;
      var resFInStr = Utilities.formatDate(new Date(r[0]), Session.getScriptTimeZone(), "yyyy-MM-dd");
      var resHInStr = formatHoraStr(r[1]);
      var resStart = new Date(resFInStr + "T" + resHInStr + ":00");

      var resFFinStr = Utilities.formatDate(new Date(r[2]), Session.getScriptTimeZone(), "yyyy-MM-dd");
      var resHFinStr = formatHoraStr(r[3]);
      var resEnd = new Date(resFFinStr + "T" + resHFinStr + ":00");

      if (reqInicio < resEnd && reqFin > resStart) {
        var eqCadena = r[4] ? r[4].toString() : "";
        var listaEqRow = eqCadena.split(", ");
        listaEqRow.forEach(function(eq) {
          if (equiposOcupados.indexOf(eq.trim()) === -1) {
            equiposOcupados.push(eq.trim());
          }
        });
      }
    });
  }

  // Bloqueos de gestión (revisión, mantenimiento, verificación): mismo criterio de solapamiento
  leerBloqueos_(true).forEach(function (b) {
    if (reqInicio < b.hasta && reqFin > b.desde && equiposOcupados.indexOf(b.equipo) === -1) {
      equiposOcupados.push(b.equipo);
    }
  });

  return todosLosEquipos.filter(function(eq) {
    return equiposOcupados.indexOf(eq) === -1;
  });
}

function obtenerEventosUsuarioAnonimo(equipoFiltro) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(HOJA_RESERVAS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var anchoEventos = Math.max(6, Math.min(COL_EXTENSIONES, sheet.getMaxColumns()) - 7);
  var data = sheet.getRange(2, 8, sheet.getLastRow() - 1, anchoEventos).getValues();
  var eventos = [];

  data.forEach(function(r) {
    if (esCanceladaEnSliceH_(r)) return;
    var fIn = Utilities.formatDate(new Date(r[0]), Session.getScriptTimeZone(), "yyyy-MM-dd");
    var hIn = formatHoraStr(r[1]);
    var fFin = Utilities.formatDate(new Date(r[2]), Session.getScriptTimeZone(), "yyyy-MM-dd");
    var hFin = formatHoraStr(r[3]);
    var equiposRowStr = r[4] ? r[4].toString() : "";
    var tipoActividad = r[5] ? r[5].toString() : "";

    var colorAct = tipoActividad.startsWith("Otro:") ? "Default" : tipoActividad;
    var colorAsignado = PALETA_ACTIVIDADES[colorAct] || PALETA_ACTIVIDADES["Default"];

    if (equipoFiltro && equipoFiltro !== "TODOS") {
      var listaEquipos = equiposRowStr.split(", ").map(function(e){ return e.trim(); });
      if (listaEquipos.indexOf(equipoFiltro) === -1) return;
    }

    eventos.push({
      title: "(R) " + equiposRowStr,
      start: fIn + "T" + hIn,
      end: fFin + "T" + hFin,
      backgroundColor: colorAsignado,
      borderColor: colorAsignado,
      textColor: "#FFFFFF",
      extendedProps: { equipos: equiposRowStr, actividad: tipoActividad }
    });
  });
  return eventos;
}

function formatHoraStr(val) {
  if (Object.prototype.toString.call(val) === '[object Date]') {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), "HH:mm");
  }
  return val.toString();
}

// ============================================================================
// RESERVAS
// ============================================================================

function registrarReserva(datosCrudos) {
  var lock = null;
  var tieneLock = false;
  var datos;
  var idReserva = "";

  try {
    // 0) La identidad la define la SESIÓN, nunca lo que se escriba en el formulario
    var sesion = obtenerEmailActivo_();
    if (!sesion) {
      return { exito: false, mensaje: "No se pudo identificar su sesión. Abra la aplicación iniciando sesión con su cuenta institucional @unal.edu.co." };
    }
    var crudos = (datosCrudos && typeof datosCrudos === "object") ? JSON.parse(JSON.stringify(datosCrudos)) : datosCrudos;
    if (crudos && typeof crudos === "object") crudos.correo = sesion;

    // 1) Validación y normalización (sin tocar hojas)
    var v = validarDatosReserva_(crudos);
    if (!v.ok) return { exito: false, mensaje: v.mensaje };
    datos = v.datos;

    // 2) Serializar la sección crítica
    lock = LockService.getScriptLock();
    tieneLock = lock.tryLock(LOCK_ESPERA_MS);
    if (!tieneLock) {
      return { exito: false, mensaje: "El sistema está procesando otras solicitudes. Intente de nuevo en unos segundos." };
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_RESERVAS);
    if (!sheet) return { exito: false, mensaje: "No se encontró la hoja de reservas." };

    asegurarColumnasExtra_(sheet);

    // 3) Idempotencia: ¿esta misma solicitud ya fue registrada?
    if (datos.idSolicitud) {
      var previa = buscarSolicitudRepetida_(sheet, datos.idSolicitud);
      if (previa) {
        if (previa.correo === datos.correo && previa.equipo === datos.equipos[0]) {
          return {
            exito: true,
            duplicada: true,
            mensaje: "Su reserva ya estaba registrada (solicitud repetida). No se creó una reserva duplicada."
          };
        }
        return { exito: false, mensaje: "El identificador de la solicitud ya fue utilizado. Recargue la página e intente de nuevo." };
      }
    }

    var fechaRegistro = new Date();
    idReserva = "RES-" + fechaRegistro.getTime();

    var reqInicio = new Date(datos.fechaInicio + "T" + datos.horaInicio + ":00");
    var reqFin = new Date(datos.fechaFin + "T" + datos.horaFin + ":00");
    if (isNaN(reqInicio.getTime()) || isNaN(reqFin.getTime())) {
      return { exito: false, mensaje: "Fecha u hora inválida." };
    }

    // Margen de 5 minutos hacia el pasado
    var limitePermitidoInicio = new Date(fechaRegistro.getTime() - (5 * 60 * 1000));
    if (reqInicio < limitePermitidoInicio) {
      return { exito: false, mensaje: "La hora de inicio de la reserva no puede ser anterior a 5 minutos respecto a la hora actual." };
    }
    if (reqInicio >= reqFin) {
      return { exito: false, mensaje: "La fecha/hora de fin debe ser posterior a la de inicio." };
    }

    // 4) Revalidar disponibilidad DENTRO del bloqueo (lee la hoja en este instante;
    //    excluye los equipos cuyo Estado no es reservable)
    var disponibles = obtenerEquiposDisponibles(datos.fechaInicio, datos.horaInicio, datos.fechaFin, datos.horaFin);
    if (disponibles.indexOf(datos.equipos[0]) === -1) {
      return { exito: false, mensaje: "El computador seleccionado ya fue reservado en ese bloque horario o no está disponible." };
    }

    // 4b) Límite opcional de reservas vigentes por usuario (0 = desactivado)
    if (MAX_RESERVAS_ACTIVAS_USUARIO > 0) {
      var vigentes = contarReservasVigentes_(datos.correo);
      if (vigentes >= MAX_RESERVAS_ACTIVAS_USUARIO) {
        return {
          exito: false,
          mensaje: "Ya tiene " + vigentes + " reservas activas o futuras. El máximo es " +
            MAX_RESERVAS_ACTIVAS_USUARIO + ". Cancele o libere una antes de crear otra."
        };
      }
    }

    // 5) Escritura + confirmación (A..O como siempre; P = ID de solicitud; Q = desatendido; R = mensaje)
    var destino = sheet.getLastRow() + 1;
    escribirFilaReserva_(sheet, destino, [
      fechaRegistro, datos.tipoUsuario, datos.nombre, datos.cedula, datos.correo,
      datos.programa, datos.matricula, datos.fechaInicio, datos.horaInicio,
      datos.fechaFin, datos.horaFin, datos.equipos.join(", "),
      datos.tipoActividad, datos.detalleActividad, idReserva, datos.idSolicitud || "",
      datos.desatendido ? "Sí" : "", datos.mensaje || "",
      "Activa", "", "", 0
    ]);
    SpreadsheetApp.flush();

    var idEscrito = sheet.getRange(destino, 15).getValue();
    if (String(idEscrito).trim() !== idReserva) {
      Logger.log("No se pudo confirmar la escritura de " + idReserva + " en la fila " + destino + " (se leyó: " + idEscrito + ")");
      // incierto: el cliente conserva el ID de solicitud y el reintento no duplicará
      return { exito: false, incierto: true, mensaje: "No se pudo confirmar el registro de la reserva. Revise el calendario antes de reintentar." };
    }
  } catch (error) {
    Logger.log("Error en registrarReserva: " + error.toString());
    return { exito: false, incierto: true, mensaje: "Error procesando la reserva. Revise el calendario antes de reintentar." };
  } finally {
    if (tieneLock) {
      try { lock.releaseLock(); } catch (e) { Logger.log("No se pudo liberar el lock: " + e); }
    }
  }

  // 6) Correo FUERA de la sección crítica; su fallo no revierte la reserva
  var envio = enviarCorreosNotificacion_(datos, idReserva);
  var enviado = !!(envio && envio.exito);
  return {
    exito: true,
    mensaje: enviado
      ? "¡Reserva realizada con éxito! Comprobante enviado a su correo."
      : "¡Reserva realizada con éxito! No se pudo enviar el comprobante por correo; conserve esta confirmación."
  };
}

function enviarCorreosNotificacion_(datos, idReserva) {
  try {
    if (!datos) datos = {};
    var datosSinEscapar = datos;
    datos = escaparCamposHtml_(datos);
    var equipos = Array.isArray(datos.equipos) ? datos.equipos : (datos.equipos ? [datos.equipos] : []);
    var listaEquiposHtml = equipos.length > 0 ? equipos.map(function(eq){ return "<li style='margin-bottom: 4px;'>" + eq + "</li>"; }).join("") : "<li>No especificado</li>";
    var correoDestino = datos.correo ? datos.correo.trim() : "";
    if (!correoDestino) return { exito: false };

    var urlBase = ScriptApp.getService().getUrl();
    var urlCancelar = urlBase + "?action=cancelar&id=" + idReserva;
    var urlLiberar = urlBase + "?action=liberar&id=" + idReserva;
    var eqTexto = Array.isArray(datosSinEscapar.equipos) ? datosSinEscapar.equipos.join(", ") : "";
    var mId = /^\[([^\]]+)\]/.exec(eqTexto);
    var urlCalendario = urlGoogleCalendar_(
      "Reserva LADME: " + eqTexto,
      String(datosSinEscapar.fechaInicio), String(datosSinEscapar.horaInicio),
      String(datosSinEscapar.fechaFin), String(datosSinEscapar.horaFin),
      "Equipo: " + eqTexto + (mId ? "\nFicha (liberar o extender): " + urlBase + "?asset=" + encodeURIComponent(mId[1]) : "")
    );

    var htmlUsuario = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #6d28d9; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #6d28d9; color: white; padding: 20px; text-align: center;">
          <h2 style="margin:0;">Comprobante de Reserva - LADME</h2>
          <p style="margin:5px 0 0 0; font-size: 13px;">Laboratorio de Aprendizaje de Datos y Modelado Estadístico - UNAL</p>
        </div>
        <div style="padding: 20px; color: #333; line-height: 1.5;">
          <p>Estimado(a) <strong>${datos.nombre || "Usuario"}</strong>,</p>
          <p>Se ha registrado exitosamente la reserva del computador:</p>

          <table style="width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 14px;">
            <tr style="background-color: #f3e8ff;"><td style="padding: 8px; border: 1px solid #e9d5ff; font-weight: bold;">Inicio:</td><td style="padding: 8px; border: 1px solid #e9d5ff;">${datos.fechaInicio} a las ${datos.horaInicio}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #e9d5ff; font-weight: bold;">Fin:</td><td style="padding: 8px; border: 1px solid #e9d5ff;">${datos.fechaFin} a las ${datos.horaFin}</td></tr>
            <tr style="background-color: #f3e8ff;"><td style="padding: 8px; border: 1px solid #e9d5ff; font-weight: bold;">Programa/Nivel:</td><td style="padding: 8px; border: 1px solid #e9d5ff;">${datos.programa || "N/A"} (Matrícula: ${datos.matricula || "N/A"})</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #e9d5ff; font-weight: bold;">Actividad:</td><td style="padding: 8px; border: 1px solid #e9d5ff;">${datos.tipoActividad || "N/A"}</td></tr>
            <tr style="background-color: #f3e8ff;"><td style="padding: 8px; border: 1px solid #e9d5ff; font-weight: bold;">Detalle:</td><td style="padding: 8px; border: 1px solid #e9d5ff;">${datos.detalleActividad || "N/A"}</td></tr>
          </table>

          <p style="font-weight: bold; margin-bottom: 5px;">Computador(es) Asignado(s):</p>
          <ul style="margin-top: 0; padding-left: 20px;">${listaEquiposHtml}</ul>

          <div style="margin-top: 25px; padding: 15px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; text-align: center;">
            <p style="font-size: 13px; color: #334155; margin: 0 0 12px 0; font-weight: bold;">¿Desea gestionar o modificar esta reserva?</p>
            <div style="margin-bottom: 10px;">
              <a href="${urlLiberar}" style="background-color: #0d9488; color: white; padding: 9px 15px; text-decoration: none; border-radius: 5px; font-size: 13px; font-weight: bold; margin-right: 5px; display: inline-block;">
                ⚡ Liberar Equipo Antes
              </a>
              <a href="${urlCancelar}" style="background-color: #dc2626; color: white; padding: 9px 15px; text-decoration: none; border-radius: 5px; font-size: 13px; font-weight: bold; display: inline-block;">
                ❌ Cancelar Reserva
              </a>
              <a href="${escHtml_(urlCalendario)}" style="background-color: #2b6cb0; color: white; padding: 9px 15px; text-decoration: none; border-radius: 5px; font-size: 13px; font-weight: bold; margin-left: 5px; display: inline-block;">
                📅 Agregar a mi calendario
              </a>
            </div>
            <p style="font-size: 11px; color: #64748b; margin: 5px 0 0 0; line-height: 1.3;">
              • <strong>Liberar Equipo:</strong> Si termina su actividad antes del horario previsto, use esta opción para dejar libre el equipo para otros usuarios.<br>
              • <strong>Cancelar Reserva:</strong> Si ya no va a asistir al laboratorio, anule totalmente su reserva.
            </p>
          </div>

        </div>
      </div>
    `;
    MailApp.sendEmail({ to: correoDestino, subject: "Confirmación de Reserva LADME", htmlBody: htmlUsuario, name: NOMBRE_REMITENTE, replyTo: CUENTA_REMITENTE });
    return { exito: true };
  } catch (e) {
    return { exito: false, error: e.toString() };
  }
}

function buscarFilaPorId_(idReserva) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(HOJA_RESERVAS);
  if (!sheet || sheet.getLastRow() < 2) return null;

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var colId = row[14] ? row[14].toString().trim() : "";
    if (colId === idReserva) {
      return { sheet: sheet, rowIndex: i + 1, rowData: row };
    }
    if (row[0] && row[0] instanceof Date) {
      var tsId = "RES-" + row[0].getTime();
      if (tsId === idReserva) {
        return { sheet: sheet, rowIndex: i + 1, rowData: row };
      }
    }
  }
  return null;
}

// ============================================================================
// ENLACES DEL CORREO (CANCELAR / LIBERAR)
// ============================================================================

function generarPaginaConfirmacionHtml_(action, idReserva) {
  var res = buscarFilaPorId_(idReserva);
  if (!res) {
    return generarPaginaRespuestaHtml_("Reserva No Encontrada", "No se encontró el registro de la reserva solicitada. Es posible que ya haya sido procesada o cancelada anteriormente.", false);
  }

  var rowData = res.rowData;
  if (esReservaCancelada_(rowData)) {
    return generarPaginaRespuestaHtml_("Reserva Ya Cancelada", "Esta reserva fue cancelada y ya no ocupa el equipo. Si desea volver a usarlo, haga una reserva nueva.", false);
  }
  if (!puedeActuarSobreFila_(rowData)) {
    return generarPaginaRespuestaHtml_("Acceso no autorizado", MENSAJE_ENLACE_NO_AUTORIZADO, false);
  }

  var usuario = escHtml_(rowData[2] || "Usuario");
  var equipo = escHtml_(rowData[11] || "Equipo");
  var fInStr = Utilities.formatDate(new Date(rowData[7]), Session.getScriptTimeZone(), "yyyy-MM-dd");
  var hInStr = formatHoraStr(rowData[8]);
  var fFinStr = Utilities.formatDate(new Date(rowData[9]), Session.getScriptTimeZone(), "yyyy-MM-dd");
  var hFinStr = formatHoraStr(rowData[10]);

  var urlBase = ScriptApp.getService().getUrl();
  var urlConfirmar = urlBase + "?action=" + encodeURIComponent(action) + "&id=" + encodeURIComponent(idReserva) + "&confirm=true";

  var titulo = action === "cancelar" ? "Confirmar Cancelación" : "Confirmar Liberación Anticipada";
  var colorHeader = action === "cancelar" ? "#dc2626" : "#0d9488";
  var icono = action === "cancelar" ? "fa-circle-xmark" : "fa-bolt";

  var mensaje = action === "cancelar"
    ? "¿Está seguro que desea <strong>cancelar completamente</strong> su reserva? El registro quedará marcado como cancelado y el equipo quedará libre para otros usuarios."
    : "Si termina su actividad antes del horario previsto, use esta opción para dejar libre el equipo para otros usuarios.<br><br>¿Desea confirmar la <strong>liberación inmediata</strong> del computador?";

  var html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${titulo} - LADME</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
      <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css" rel="stylesheet">
      <style>
        body { background-color: #fcfaff; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
        .card-custom { max-width: 580px; width: 92%; border: none; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); overflow: hidden; background: white; }
        .card-header-custom { background-color: ${colorHeader}; color: white; padding: 25px; text-align: center; }
        .card-body { padding: 30px; text-align: center; color: #334155; line-height: 1.6; }
        .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; text-align: left; margin: 20px 0; font-size: 14px; }
      </style>
    </head>
    <body>
      <div class="card-custom">
        <div class="card-header-custom">
          <i class="fa-solid ${icono} fa-3x mb-2"></i>
          <h3 class="mb-0 fw-bold">${titulo}</h3>
        </div>
        <div class="card-body">
          <p class="fs-6 mb-3">${mensaje}</p>

          <div class="info-box">
            <p class="mb-1"><strong>Usuario:</strong> ${usuario}</p>
            <p class="mb-1"><strong>Equipo:</strong> ${equipo}</p>
            <p class="mb-0"><strong>Horario Reservado:</strong> ${fInStr} ${hInStr} a ${fFinStr} ${hFinStr}</p>
          </div>

          <div class="d-flex justify-content-center gap-3 mt-4">
            <a href="${urlConfirmar}" class="btn px-4 py-2 text-white fw-bold" style="background-color: ${colorHeader}; border-radius: 6px; text-decoration: none;">
              <i class="fa-solid fa-check me-1"></i> Sí, Confirmar
            </a>
            <a href="${urlBase}" class="btn btn-outline-secondary px-4 py-2 fw-bold" style="border-radius: 6px; text-decoration: none;">
              <i class="fa-solid fa-xmark me-1"></i> Regresar
            </a>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  return HtmlService.createHtmlOutput(html)
      .setTitle(titulo + ' - LADME')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function procesarAccionEmail_(action, idReserva) {
  var titulo = "";
  var mensaje = "";
  var esExito = false;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_ESPERA_MS)) {
    return generarPaginaRespuestaHtml_("Sistema ocupado", "El sistema está procesando otras solicitudes. Intente de nuevo en unos segundos.", false);
  }

  try {
    var res = buscarFilaPorId_(idReserva); // se busca DENTRO del bloqueo

    if (!res) {
      titulo = "Reserva No Encontrada";
      mensaje = "No se encontró el registro de la reserva solicitada. Es posible que ya haya sido cancelada previamente.";
    } else if (esReservaCancelada_(res.rowData)) {
      titulo = "Reserva Ya Cancelada";
      mensaje = "Esta reserva ya fue cancelada. No es necesario volver a procesarla.";
    } else if (!puedeActuarSobreFila_(res.rowData)) {
      titulo = "Acceso no autorizado";
      mensaje = MENSAJE_ENLACE_NO_AUTORIZADO;
    } else {
      var sheet = res.sheet;
      var rowIndex = res.rowIndex;
      var rowData = res.rowData;
      var actor = obtenerEmailActivo_() || "(sin sesión)";

      var usuario = escHtml_(rowData[2] || "Usuario");
      var equipo = escHtml_(rowData[11] || "Equipo");

      if (action === "cancelar") {
        if (!archivarReserva_(sheet, rowIndex, "CANCELADA_ENLACE", actor, "")) {
          titulo = "No se pudo completar";
          mensaje = "No fue posible registrar el historial de la operación, por eso la reserva <strong>NO</strong> se canceló. Intente de nuevo en unos minutos o contacte a la administración.";
        } else {
          asegurarColumnasExtra_(sheet);
          sheet.getRange(rowIndex, COL_ESTADO).setValue("Cancelada");
          sheet.getRange(rowIndex, COL_FECHA_CANCELACION).setValue(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"));
          sheet.getRange(rowIndex, COL_MOTIVO_CANCELACION).setValue("");
          SpreadsheetApp.flush();
          titulo = "Reserva Cancelada";
          mensaje = "Estimado(a) <strong>" + usuario + "</strong>, tu reserva del equipo <strong>" + equipo + "</strong> ha sido cancelada exitosamente y el computador ha quedado libre.";
          esExito = true;
        }
      } else if (action === "liberar") {
        var lib = ejecutarLiberacion_(sheet, rowIndex, rowData, actor, "LIBERADA_ENLACE");
        if (lib.estado === "finalizada") {
          titulo = "Reserva Ya Finalizada";
          mensaje = "Esta reserva ya había concluido previamente el " + lib.fFinStr + " a las " + lib.hFinStr + ".";
        } else if (lib.estado === "no_iniciada") {
          titulo = "Reserva Aún No Iniciada";
          mensaje = "Tu reserva inicia el " + lib.fInStr + " a las " + lib.hInStr + ". Si no vas a asistir, utiliza la opción <strong>Cancelar Reserva</strong>.";
        } else if (lib.estado === "historial") {
          // La copia guarda la hora de fin ORIGINAL, que la liberación sobrescribe.
          titulo = "No se pudo completar";
          mensaje = "No fue posible registrar el historial de la operación, por eso la reserva <strong>NO</strong> se modificó. Intente de nuevo en unos minutos o contacte a la administración.";
        } else {
          titulo = "¡Equipo Liberado Con Éxito!";
          mensaje = "Estimado(a) <strong>" + usuario + "</strong>, has finalizado anticipadamente tu uso del computador <strong>" + equipo + "</strong> a las " + lib.horaActualStr + ". El equipo ha quedado disponible inmediatamente para otros usuarios.";
          esExito = true;
        }
      } else {
        titulo = "Acción Inválida";
        mensaje = "La solicitud no contiene una acción válida.";
      }
    }
  } catch (err) {
    Logger.log("Error en procesarAccionEmail_: " + err.toString());
    titulo = "Error";
    mensaje = "No se pudo procesar la solicitud. Intente de nuevo o contacte a la administración.";
    esExito = false;
  } finally {
    try { lock.releaseLock(); } catch (e) { Logger.log("No se pudo liberar el lock: " + e); }
  }

  return generarPaginaRespuestaHtml_(titulo, mensaje, esExito);
}

function generarPaginaRespuestaHtml_(titulo, mensaje, esExito) {
  var colorHeader = esExito ? "#6d28d9" : "#c53030";
  var icono = esExito ? "fa-circle-check" : "fa-circle-exclamation";

  var html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${titulo} - LADME</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
      <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css" rel="stylesheet">
      <style>
        body { background-color: #fcfaff; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
        .card-custom { max-width: 550px; width: 90%; border: none; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); overflow: hidden; background: white; }
        .card-header-custom { background-color: ${colorHeader}; color: white; padding: 25px; text-align: center; }
        .card-body { padding: 30px; text-align: center; color: #334155; line-height: 1.6; }
      </style>
    </head>
    <body>
      <div class="card-custom">
        <div class="card-header-custom">
          <i class="fa-solid ${icono} fa-3x mb-2"></i>
          <h3 class="mb-0 fw-bold">${titulo}</h3>
        </div>
        <div class="card-body">
          <p class="fs-5 mb-4">${mensaje}</p>
          <a href="${ScriptApp.getService().getUrl()}" class="btn btn-purple px-4 py-2" style="background-color: #6d28d9; color: white; border: none; font-weight: 600; text-decoration: none; border-radius: 6px;">
            <i class="fa-solid fa-house me-2"></i> Volver al Sistema LADME
          </a>
        </div>
      </div>
    </body>
    </html>
  `;
  return HtmlService.createHtmlOutput(html)
      .setTitle(titulo + ' - LADME')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================================================
// FICHA DE EQUIPO (entrada por NFC / QR), CONTACTO Y ACCIONES DEL TITULAR
// Privacidad: los usuarios NUNCA reciben nombre ni correo de quien reservó.
// Solo la administración ve el contacto; los demás pueden enviar un mensaje por el sistema.
// ============================================================================

/** Busca un equipo del catálogo por su ID interno (columna A, p. ej. "UNAL-05"). Devuelve el objeto del catálogo o null. */
function buscarEquipoPorId_(assetId) {
  var id = String(assetId === null || assetId === undefined ? "" : assetId).trim().toUpperCase();
  if (!/^[A-Z0-9-]{3,20}$/.test(id)) return null;
  var cat = leerCatalogoEquipos_();
  for (var i = 0; i < cat.length; i++) {
    if (String(cat[i].id).trim().toUpperCase() === id) return cat[i];
  }
  return null;
}

/** Reservas de un equipo (por su etiqueta), con inicio/fin ya calculados, ordenadas por inicio. */
function todasLasReservas_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_RESERVAS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var ncol = Math.min(COL_EXTENSIONES, sheet.getMaxColumns());
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, ncol).getValues();
  var zona = Session.getScriptTimeZone();
  var salida = [];
  data.forEach(function (row, i) {
    try {
      if (esReservaCancelada_(row)) return;
      var equipos = (row[11] ? row[11].toString() : "").split(", ").map(function (x) { return x.trim(); }).filter(String);
      var inicio = new Date(Utilities.formatDate(new Date(row[7]), zona, "yyyy-MM-dd") + "T" + formatHoraStr(row[8]) + ":00");
      var fin = new Date(Utilities.formatDate(new Date(row[9]), zona, "yyyy-MM-dd") + "T" + formatHoraStr(row[10]) + ":00");
      salida.push({ numFila: i + 2, row: row, equipos: equipos, inicio: inicio, fin: fin, estado: estadoReserva_(row), extensiones: Number(row[COL_EXTENSIONES - 1]) || 0 });
    } catch (err) {
      Logger.log("Fila " + (i + 2) + " omitida: " + err.toString());
    }
  });
  salida.sort(function (a, b) { return a.inicio - b.inicio; });
  return salida;
}

/** Reservas de un equipo (por su etiqueta), ordenadas por inicio. */
function reservasDeEquipo_(etiqueta) {
  return todasLasReservas_().filter(function (r) { return r.equipos.indexOf(etiqueta) !== -1; });
}

/**
 * Ficha pública de un equipo. NO incluye nombre ni correo de quien reservó, salvo para administradores.
 * El ID de la reserva en curso solo se entrega al titular y a los administradores.
 */
function obtenerFichaEquipo(assetId) {
  var eq = buscarEquipoPorId_(assetId);
  if (!eq) return { ok: false, mensaje: "No se encontró un equipo con ese identificador." };

  var sesion = obtenerEmailActivo_();
  var admin = esAdminActual_();
  var ahora = new Date();

  var actual = null;
  var futuras = [];
  reservasDeEquipo_(eq.etiqueta).forEach(function (r) {
    if (r.fin <= ahora) return;
    if (r.inicio <= ahora) {
      if (!actual || r.fin > actual.fin) actual = r;
    } else {
      futuras.push(r);
    }
  });

  var bloqueoActual = null;
  var bloqueosProx = [];
  leerBloqueos_(true)
    .filter(function (b) { return b.equipo === eq.etiqueta; })
    .sort(function (a, b) { return a.desde - b.desde; })
    .forEach(function (b) {
      if (b.desde <= ahora && ahora < b.hasta) bloqueoActual = b;
      else if (b.desde > ahora) bloqueosProx.push(b);
    });

  var ficha = {
    ok: true,
    ahora: ahora.toISOString(),
    esAdmin: admin,
    equipo: {
      id: eq.id, etiqueta: eq.etiqueta, nombre: eq.nombre, marca: eq.marca, ubicacion: eq.ubicacion,
      estado: eq.estado || "Activo", reservable: eq.reservable
    },
    usoActual: null,
    libreHasta: null,
    bloqueoActual: bloqueoActual ? { hasta: bloqueoActual.hasta.toISOString(), motivo: bloqueoActual.motivo } : null,
    bloqueosProximos: bloqueosProx.slice(0, 5).map(function (b) {
      return { desde: b.desde.toISOString(), hasta: b.hasta.toISOString(), motivo: b.motivo };
    }),
    proximas: futuras.slice(0, 8).map(function (r) {
      return {
        inicio: r.inicio.toISOString(), fin: r.fin.toISOString(),
        desatendido: !!(r.row[COL_DESATENDIDO - 1])
      };
    })
  };

  if (actual) {
    var dueno = actual.row[4] ? actual.row[4].toString().toLowerCase().trim() : "";
    var esTitular = !!sesion && dueno === sesion;
    ficha.usoActual = {
      inicio: actual.inicio.toISOString(),
      fin: actual.fin.toISOString(),
      desatendido: !!(actual.row[COL_DESATENDIDO - 1]),
      mensaje: actual.row[COL_MENSAJE - 1] ? actual.row[COL_MENSAJE - 1].toString() : "",
      esTitular: esTitular,
      // Política D-02: 168 h + una única extensión de hasta 24 h (192 h en total).
      extensionesUsadas: Number(actual.row[COL_EXTENSIONES - 1]) || 0,
      extensionesMax: EXTENSIONES_MAX,
      horasTotales: (actual.fin.getTime() - actual.inicio.getTime()) / 3600000,
      horasMaxTotal: DURACION_MAX_TOTAL_HORAS,
      horasMaxExtension: EXTENSION_MAX_HORAS
    };
    ficha.usoActual.extensible = (esTitular || admin) &&
      (admin || (ficha.usoActual.extensionesUsadas < EXTENSIONES_MAX &&
        ficha.usoActual.horasTotales < DURACION_MAX_TOTAL_HORAS));
    if (esTitular || admin) ficha.usoActual.idReserva = idDeFila_(actual.row);
    if (admin) {
      ficha.admin = {
        titular: {
          nombre: actual.row[2] ? actual.row[2].toString() : "",
          correo: actual.row[4] ? actual.row[4].toString() : "",
          actividad: actual.row[12] ? actual.row[12].toString() : "",
          detalle: actual.row[13] ? actual.row[13].toString() : ""
        }
      };
    }
  } else {
    var candidatos = [];
    if (futuras.length > 0) candidatos.push(futuras[0].inicio.getTime());
    if (bloqueosProx.length > 0) candidatos.push(bloqueosProx[0].desde.getTime());
    if (candidatos.length > 0) ficha.libreHasta = new Date(Math.min.apply(null, candidatos)).toISOString();
  }
  return ficha;
}

/**
 * Envía un mensaje a quien tiene el equipo reservado AHORA, sin revelar su correo al solicitante.
 * El titular recibe el correo del solicitante en "Responder a", de modo que puedan hablar directamente.
 */
function contactarTitular(assetId, mensaje) {
  var sesion = obtenerEmailActivo_();
  if (!sesion) return { exito: false, mensaje: "Debe iniciar sesión con su cuenta institucional para enviar un mensaje." };

  var eq = buscarEquipoPorId_(assetId);
  if (!eq) return { exito: false, mensaje: "No se encontró el equipo." };

  var texto = (typeof mensaje === "string") ? mensaje.replace(/[\r\n\t]+/g, " ").trim() : "";
  if (texto.length > 300) return { exito: false, mensaje: "El mensaje admite máximo 300 caracteres." };

  var ahora = new Date();
  var actual = null;
  reservasDeEquipo_(eq.etiqueta).forEach(function (r) {
    if (r.inicio <= ahora && r.fin > ahora) actual = r;
  });
  if (!actual) return { exito: false, mensaje: "En este momento no hay una reserva vigente en ese equipo, así que no hay a quién contactar." };

  var titular = actual.row[4] ? actual.row[4].toString().toLowerCase().trim() : "";
  if (!titular) return { exito: false, mensaje: "La reserva no tiene un contacto registrado. Escriba a la administración del laboratorio." };
  if (titular === sesion) return { exito: false, mensaje: "Usted es quien tiene este equipo reservado." };

  var cache = CacheService.getScriptCache();
  var clave = "ct:" + sesion + ":" + eq.id;
  if (cache.get(clave)) {
    return { exito: false, mensaje: "Ya envió un mensaje sobre este equipo hace poco. Espere unos minutos antes de insistir." };
  }

  var zona = Session.getScriptTimeZone();
  var finTxt = Utilities.formatDate(actual.fin, zona, "yyyy-MM-dd HH:mm");
  var urlFicha = ScriptApp.getService().getUrl() + "?asset=" + encodeURIComponent(eq.id);
  var html =
    '<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #6d28d9; border-radius: 8px; overflow: hidden;">' +
    '<div style="background-color: #6d28d9; color: white; padding: 16px 20px;"><h3 style="margin:0;">Alguien pregunta por su equipo reservado</h3></div>' +
    '<div style="padding: 20px; color: #333; line-height: 1.5;">' +
    '<p>Hola <strong>' + escHtml_(actual.row[2] || "") + '</strong>,</p>' +
    '<p>Una persona del laboratorio quiere saber si puede usar el equipo <strong>' + escHtml_(eq.etiqueta) + '</strong>, que usted tiene reservado hasta <strong>' + escHtml_(finTxt) + '</strong>.</p>' +
    '<p><strong>Quién pregunta:</strong> ' + escHtml_(sesion) + '</p>' +
    '<p><strong>Mensaje:</strong> ' + (texto ? escHtml_(texto) : '<em>(sin mensaje)</em>') + '</p>' +
    '<p>Puede <strong>responder a este correo</strong> para hablar directamente con esa persona.</p>' +
    '<p style="font-size: 13px; color: #64748b;">Si ya terminó, puede liberar el equipo desde su ficha: <a href="' + urlFicha + '">abrir ficha de ' + escHtml_(eq.id) + '</a>.</p>' +
    '</div></div>';

  try {
    MailApp.sendEmail({
      to: titular,
      replyTo: sesion,
      name: NOMBRE_REMITENTE,
      subject: "LADME: preguntan por el equipo " + eq.id,
      htmlBody: html
    });
  } catch (err) {
    Logger.log("Error enviando contacto: " + err.toString());
    return { exito: false, mensaje: "No se pudo enviar el mensaje. Intente de nuevo o contacte a la administración." };
  }

  cache.put(clave, "1", CONTACTO_ESPERA_SEG);
  registrarContacto_(sesion, eq, idDeFila_(actual.row), titular, texto);
  return { exito: true, mensaje: "Mensaje enviado. Quien tiene el equipo recibirá su aviso y podrá responderle a su correo." };
}

/**
 * Datos de la ÚLTIMA reserva de la propia sesión, para autocompletar el formulario.
 * Solo devuelve datos de quien pregunta (se busca por el correo de la sesión).
 */
function obtenerMiPerfil() {
  var sesion = obtenerEmailActivo_();
  if (!sesion) return { ok: false };
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_RESERVAS);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, correo: sesion, datos: null };
  var anchoPerfil = Math.max(14, Math.min(COL_ESTADO, sheet.getMaxColumns()));
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, anchoPerfil).getValues();
  for (var i = data.length - 1; i >= 0; i--) {
    if (esReservaCancelada_(data[i])) continue;
    var correo = data[i][4] ? data[i][4].toString().toLowerCase().trim() : "";
    if (correo === sesion) {
      return {
        ok: true, correo: sesion,
        datos: {
          nombre: data[i][2] ? data[i][2].toString() : "",
          cedula: data[i][3] ? data[i][3].toString() : "",
          programa: data[i][5] ? data[i][5].toString() : "",
          matricula: data[i][6] ? data[i][6].toString() : "",
          actividad: data[i][12] ? data[i][12].toString() : "",
          detalle: data[i][13] ? data[i][13].toString() : ""
        }
      };
    }
  }
  return { ok: true, correo: sesion, datos: null };
}

/** Deja constancia de cada mensaje enviado (solo la administración ve esta hoja). Todo se guarda como texto. */
function registrarContacto_(solicitante, eq, idReserva, titular, texto) {
  var lock = LockService.getScriptLock();
  var tiene = false;
  try {
    tiene = lock.tryLock(5000);
    if (!tiene) { Logger.log("Contacto sin registrar en hoja (bloqueo ocupado): " + solicitante + " -> " + eq.id); return; }
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var hoja = ss.getSheetByName(HOJA_CONTACTOS);
    if (!hoja) {
      hoja = ss.insertSheet(HOJA_CONTACTOS);
      hoja.getRange(1, 1, 1, ENCABEZADOS_CONTACTOS.length)
        .setValues([ENCABEZADOS_CONTACTOS])
        .setFontWeight("bold").setBackground("#6d28d9").setFontColor("#FFFFFF");
      hoja.setFrozenRows(1);
    }
    var fila = [
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"),
      solicitante, eq.etiqueta, idReserva, titular, texto || ""
    ];
    var destino = hoja.getLastRow() + 1;
    var rango = hoja.getRange(destino, 1, 1, fila.length);
    rango.setNumberFormat("@");
    rango.setValues([fila]);
  } catch (err) {
    Logger.log("No se pudo registrar el contacto: " + err.toString());
  } finally {
    if (tiene) { try { lock.releaseLock(); } catch (e) { Logger.log("No se pudo liberar el lock: " + e); } }
  }
}

/** El titular (o un administrador) libera su reserva en curso desde la ficha. */
function liberarDesdeFicha(idReserva) {
  var lock = null;
  var tieneLock = false;
  try {
    if (!idReserva || !/^RES-\d+$/.test(String(idReserva))) return { exito: false, mensaje: "Solicitud inválida." };

    lock = LockService.getScriptLock();
    tieneLock = lock.tryLock(LOCK_ESPERA_MS);
    if (!tieneLock) return { exito: false, mensaje: "El sistema está procesando otras solicitudes. Intente de nuevo en unos segundos." };

    var res = buscarFilaPorId_(String(idReserva));
    if (!res) return { exito: false, mensaje: "No se encontró la reserva (puede haber sido cancelada)." };
    if (esReservaCancelada_(res.rowData)) return { exito: false, mensaje: "Esta reserva ya fue cancelada." };
    if (!esTitularOAdmin_(res.rowData)) return { exito: false, mensaje: "Solo quien hizo la reserva (o la administración) puede liberarla." };

    var lib = ejecutarLiberacion_(res.sheet, res.rowIndex, res.rowData, obtenerEmailActivo_() || "(sin sesión)", "LIBERADA_FICHA");
    if (lib.estado === "ok") {
      return { exito: true, mensaje: "Equipo liberado a las " + lib.horaActualStr + ". Ya está disponible para otros usuarios." };
    }
    if (lib.estado === "finalizada") return { exito: false, mensaje: "Esta reserva ya había terminado." };
    if (lib.estado === "no_iniciada") return { exito: false, mensaje: "La reserva aún no ha comenzado. Si no la va a usar, cancélela desde el enlace del correo de confirmación." };
    return { exito: false, mensaje: "No se pudo guardar el historial, por eso la reserva NO se modificó. Intente de nuevo." };
  } catch (err) {
    Logger.log("Error en liberarDesdeFicha: " + err.toString());
    return { exito: false, mensaje: "Error al liberar el equipo. Revise el estado de la reserva e intente de nuevo." };
  } finally {
    if (tieneLock) { try { lock.releaseLock(); } catch (e) { Logger.log("No se pudo liberar el lock: " + e); } }
  }
}

/**
 * El titular (o un administrador) extiende el FIN de su reserva en curso desde la ficha.
 * Política D-02: una sola extensión de hasta 24 h; total máximo 192 h.
 * Reutiliza obtenerEquiposDisponibles: el tramo [fin actual, nuevo fin) debe estar libre y el equipo operativo.
 */
function extenderDesdeFicha(idReserva, fechaFin, horaFin) {
  var lock = null;
  var tieneLock = false;
  try {
    if (!idReserva || !/^RES-\d+$/.test(String(idReserva))) return { exito: false, mensaje: "Solicitud inválida." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fechaFin)) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(horaFin))) {
      return { exito: false, mensaje: "Fecha u hora de fin inválida." };
    }

    lock = LockService.getScriptLock();
    tieneLock = lock.tryLock(LOCK_ESPERA_MS);
    if (!tieneLock) return { exito: false, mensaje: "El sistema está procesando otras solicitudes. Intente de nuevo en unos segundos." };

    var hojaReservas = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_RESERVAS);
    if (!hojaReservas) return { exito: false, mensaje: "No se encontró la hoja de reservas." };
    asegurarColumnasExtra_(hojaReservas);

    var res = buscarFilaPorId_(String(idReserva));
    if (!res) return { exito: false, mensaje: "No se encontró la reserva (puede haber sido cancelada)." };
    if (esReservaCancelada_(res.rowData)) return { exito: false, mensaje: "Esta reserva ya fue cancelada." };
    if (!esTitularOAdmin_(res.rowData)) return { exito: false, mensaje: "Solo quien hizo la reserva (o la administración) puede extenderla." };

    var zona = Session.getScriptTimeZone();
    var fInAct = Utilities.formatDate(new Date(res.rowData[7]), zona, "yyyy-MM-dd");
    var hInAct = formatHoraStr(res.rowData[8]);
    var inicioActual = new Date(fInAct + "T" + hInAct + ":00");
    var fFinAct = Utilities.formatDate(new Date(res.rowData[9]), zona, "yyyy-MM-dd");
    var hFinAct = formatHoraStr(res.rowData[10]);
    var finActual = new Date(fFinAct + "T" + hFinAct + ":00");
    var nuevoFin = new Date(fechaFin + "T" + horaFin + ":00");
    var ahora = new Date();

    if (isNaN(nuevoFin.getTime())) return { exito: false, mensaje: "Fecha u hora de fin inválida." };
    if (finActual <= ahora) return { exito: false, mensaje: "Esta reserva ya terminó. Haga una reserva nueva." };
    if (nuevoFin <= finActual) return { exito: false, mensaje: "El nuevo fin debe ser posterior al fin actual (" + fFinAct + " " + hFinAct + ")." };

    var extensiones = Number(res.rowData[COL_EXTENSIONES - 1]) || 0;
    var admin = esAdminActual_();
    var politica = validarPoliticaExtension_(inicioActual, finActual, nuevoFin, extensiones, admin);
    if (!politica.ok) return { exito: false, mensaje: politica.mensaje };

    // Todos los equipos de la fila deben seguir libres y operativos en el tramo añadido
    var libres = obtenerEquiposDisponibles(fFinAct, hFinAct, fechaFin, horaFin);
    var equiposFila = (res.rowData[11] ? res.rowData[11].toString() : "").split(", ").map(function (x) { return x.trim(); });
    for (var i = 0; i < equiposFila.length; i++) {
      if (libres.indexOf(equiposFila[i]) === -1) {
        return { exito: false, mensaje: "No se puede extender: el equipo tiene otra reserva en ese tramo o no está disponible." };
      }
    }

    var detalle = "Fin anterior: " + fFinAct + " " + hFinAct + " | Fin nuevo: " + fechaFin + " " + horaFin +
      " | Extensión " + (extensiones + 1) + " de " + EXTENSIONES_MAX +
      " | Horas añadidas: " + politica.horasAgregadas.toFixed(2) +
      " | Total: " + politica.horasTotales.toFixed(2) + " h" +
      (admin ? " | Aplicada por admin" : "");
    if (!archivarReserva_(res.sheet, res.rowIndex, "EXTENDIDA_FICHA", obtenerEmailActivo_() || "(sin sesión)", detalle)) {
      return { exito: false, mensaje: "No se pudo guardar el historial, por eso la reserva NO se modificó. Intente de nuevo." };
    }

    res.sheet.getRange(res.rowIndex, 10).setValue(fechaFin);
    res.sheet.getRange(res.rowIndex, 11).setValue(horaFin);
    res.sheet.getRange(res.rowIndex, COL_EXTENSIONES).setNumberFormat("@").setValue(String(extensiones + 1));
    SpreadsheetApp.flush();
    return {
      exito: true,
      mensaje: "Reserva extendida hasta el " + fechaFin + " a las " + horaFin + ". " +
        "Extensión " + (extensiones + 1) + " de " + EXTENSIONES_MAX + " usada."
    };
  } catch (err) {
    Logger.log("Error en extenderDesdeFicha: " + err.toString());
    return { exito: false, mensaje: "Error al extender la reserva. Revise su estado e intente de nuevo." };
  } finally {
    if (tieneLock) { try { lock.releaseLock(); } catch (e) { Logger.log("No se pudo liberar el lock: " + e); } }
  }
}

// ============================================================================
// RESERVA RÁPIDA, BLOQUEOS DE GESTIÓN Y VISTA DE RONDA
// ============================================================================

/** Enlace "Agregar a Google Calendar" (no necesita permisos ni credenciales). Fechas y horas ya validadas. */
function urlGoogleCalendar_(titulo, fechaInicio, horaInicio, fechaFin, horaFin, detalles) {
  function ts(f, h) { return f.replace(/-/g, "") + "T" + h.replace(":", "") + "00"; }
  return "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    "&text=" + encodeURIComponent(titulo) +
    "&dates=" + ts(fechaInicio, horaInicio) + "/" + ts(fechaFin, horaFin) +
    "&details=" + encodeURIComponent(detalles) +
    "&ctz=" + encodeURIComponent(Session.getScriptTimeZone());
}

function fechaTexto_(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm"); }

/** Acepta "yyyy-MM-dd HH:mm" o "yyyy-MM-ddTHH:mm" (datetime-local). Devuelve Date o null. */
function fechaDesdeTexto_(t) {
  var m = /^(\d{4}-\d{2}-\d{2})[ T]([01]\d|2[0-3]):([0-5]\d)$/.exec(String(t === null || t === undefined ? "" : t).trim());
  if (!m) return null;
  var d = new Date(m[1] + "T" + m[2] + ":" + m[3] + ":00");
  return isNaN(d.getTime()) ? null : d;
}

/** Valida los datos de un bloqueo. Función pura. */
function validarBloqueo_(desde, hasta, motivo, ahora) {
  function fallo(m) { return { ok: false, mensaje: m }; }
  var d = fechaDesdeTexto_(desde);
  var h = fechaDesdeTexto_(hasta);
  if (!d || !h) return fallo("Fechas inválidas.");
  if (h <= d) return fallo("El fin del bloqueo debe ser posterior al inicio.");
  if (h <= ahora) return fallo("Ese bloqueo ya terminó: elija un fin posterior a la hora actual.");
  var m = (typeof motivo === "string") ? motivo.replace(/[\r\n\t]+/g, " ").trim() : "";
  if (m.length < 3) return fallo("Escriba el motivo del bloqueo (mínimo 3 caracteres).");
  if (m.length > 200) return fallo("El motivo admite máximo 200 caracteres.");
  return { ok: true, desde: d, hasta: h, motivo: m };
}

/** Bloqueos activos. Con soloVigentes=true descarta los ya terminados. */
function leerBloqueos_(soloVigentes) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_BLOQUEOS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, ENCABEZADOS_BLOQUEOS.length).getValues();
  var ahora = new Date();
  var salida = [];
  data.forEach(function (r, i) {
    if (String(r[7]).trim() !== "Activo") return;
    var desde = fechaDesdeTexto_(r[2]);
    var hasta = fechaDesdeTexto_(r[3]);
    if (!desde || !hasta) return;
    if (soloVigentes && hasta <= ahora) return;
    salida.push({
      numFila: i + 2, id: String(r[0]), equipo: String(r[1]).trim(), desde: desde, hasta: hasta,
      motivo: String(r[4] || ""), creadoPor: String(r[5] || "")
    });
  });
  return salida;
}

function asegurarHojaBloqueos_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(HOJA_BLOQUEOS);
  if (!hoja) {
    hoja = ss.insertSheet(HOJA_BLOQUEOS);
    hoja.getRange(1, 1, 1, ENCABEZADOS_BLOQUEOS.length)
      .setValues([ENCABEZADOS_BLOQUEOS])
      .setFontWeight("bold").setBackground("#5b21b6").setFontColor("#FFFFFF");
    hoja.setFrozenRows(1);
  }
  return hoja;
}

/** SOLO ADMIN. Bloqueos vigentes y programados (fechas como texto). */
function obtenerBloqueosAdmin() {
  requireAdmin_();
  return leerBloqueos_(true)
    .sort(function (a, b) { return a.desde - b.desde; })
    .map(function (b) {
      return { id: b.id, equipo: b.equipo, desde: fechaTexto_(b.desde), hasta: fechaTexto_(b.hasta), motivo: b.motivo, creadoPor: b.creadoPor };
    });
}

/**
 * SOLO ADMIN. Bloquea un equipo entre dos fechas (revisión, mantenimiento, verificación).
 * No cancela nada: las reservas que se solapen quedan listadas en "reservas afectadas" para decidir una por una.
 */
function crearBloqueo(equipoEtiqueta, desde, hasta, motivo) {
  var lock = null;
  var tieneLock = false;
  try {
    if (!esAdminActual_()) return { exito: false, mensaje: "No tiene permisos de administrador para esta operación." };
    var etiqueta = String(equipoEtiqueta === null || equipoEtiqueta === undefined ? "" : equipoEtiqueta).trim();
    if (obtenerListaEquipos().indexOf(etiqueta) === -1) return { exito: false, mensaje: "Equipo no válido." };
    var ahora = new Date();
    var v = validarBloqueo_(desde, hasta, motivo, ahora);
    if (!v.ok) return { exito: false, mensaje: v.mensaje };

    lock = LockService.getScriptLock();
    tieneLock = lock.tryLock(LOCK_ESPERA_MS);
    if (!tieneLock) return { exito: false, mensaje: "El sistema está procesando otras solicitudes. Intente de nuevo en unos segundos." };

    var hoja = asegurarHojaBloqueos_();
    var id = "BLQ-" + ahora.getTime();
    var fila = [id, etiqueta, fechaTexto_(v.desde), fechaTexto_(v.hasta), v.motivo,
      obtenerEmailActivo_(), Utilities.formatDate(ahora, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"), "Activo", "", ""];
    var destino = hoja.getLastRow() + 1;
    var rango = hoja.getRange(destino, 1, 1, fila.length);
    rango.setNumberFormat("@");
    rango.setValues([fila]);
    SpreadsheetApp.flush();
    if (String(hoja.getRange(destino, 1).getValue()) !== id) {
      return { exito: false, mensaje: "No se pudo confirmar el bloqueo. Revise la lista antes de reintentar." };
    }

    var afectadas = reservasDeEquipo_(etiqueta).filter(function (r) {
      return r.fin > ahora && r.inicio < v.hasta && r.fin > v.desde;
    }).length;
    return {
      exito: true, afectadas: afectadas,
      mensaje: "Bloqueo creado." + (afectadas > 0
        ? " " + afectadas + " reserva(s) se solapan con ese intervalo: revíselas en «Equipos no operativos y reservas afectadas» para contactar o cancelar."
        : " No hay reservas en ese intervalo.")
    };
  } catch (err) {
    Logger.log("Error en crearBloqueo: " + err.toString());
    return { exito: false, mensaje: "Error al crear el bloqueo. Revise la lista e intente de nuevo." };
  } finally {
    if (tieneLock) { try { lock.releaseLock(); } catch (e) { Logger.log("No se pudo liberar el lock: " + e); } }
  }
}

/** SOLO ADMIN. Quita un bloqueo (queda registrado como "Cancelado", no se borra). */
function cancelarBloqueo(idBloqueo) {
  var lock = null;
  var tieneLock = false;
  try {
    if (!esAdminActual_()) return { exito: false, mensaje: "No tiene permisos de administrador para esta operación." };
    if (!/^BLQ-\d+$/.test(String(idBloqueo))) return { exito: false, mensaje: "Identificador de bloqueo inválido." };

    lock = LockService.getScriptLock();
    tieneLock = lock.tryLock(LOCK_ESPERA_MS);
    if (!tieneLock) return { exito: false, mensaje: "El sistema está procesando otras solicitudes. Intente de nuevo en unos segundos." };

    var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_BLOQUEOS);
    if (!hoja || hoja.getLastRow() < 2) return { exito: false, mensaje: "No se encontró el bloqueo." };
    var ids = hoja.getRange(2, 1, hoja.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === String(idBloqueo)) {
        var fila = i + 2;
        if (String(hoja.getRange(fila, 8).getValue()).trim() !== "Activo") return { exito: false, mensaje: "Ese bloqueo ya estaba cancelado." };
        var rango = hoja.getRange(fila, 8, 1, 3);
        rango.setNumberFormat("@");
        rango.setValues([["Cancelado", obtenerEmailActivo_(), Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss")]]);
        SpreadsheetApp.flush();
        return { exito: true, mensaje: "Bloqueo quitado. El equipo vuelve a poder reservarse en ese intervalo." };
      }
    }
    return { exito: false, mensaje: "No se encontró el bloqueo." };
  } catch (err) {
    Logger.log("Error en cancelarBloqueo: " + err.toString());
    return { exito: false, mensaje: "Error al quitar el bloqueo. Revise la lista e intente de nuevo." };
  } finally {
    if (tieneLock) { try { lock.releaseLock(); } catch (e) { Logger.log("No se pudo liberar el lock: " + e); } }
  }
}

/** SOLO ADMIN. Estado de TODOS los equipos en este instante (para la ronda de gestión). */
function obtenerVistaRondaAdmin() {
  requireAdmin_();
  var ahora = new Date();
  var porEquipo = {};
  todasLasReservas_().forEach(function (r) {
    r.equipos.forEach(function (e) { (porEquipo[e] = porEquipo[e] || []).push(r); });
  });
  var bloqueos = leerBloqueos_(true);

  return leerCatalogoEquipos_().map(function (e) {
    var actual = null;
    var proxima = null;
    (porEquipo[e.etiqueta] || []).forEach(function (r) {
      if (r.fin <= ahora) return;
      if (r.inicio <= ahora) { if (!actual || r.fin > actual.fin) actual = r; }
      else if (!proxima || r.inicio < proxima.inicio) { proxima = r; }
    });
    var bloqueoActual = null;
    bloqueos.forEach(function (b) { if (b.equipo === e.etiqueta && b.desde <= ahora && ahora < b.hasta) bloqueoActual = b; });
    return {
      id: e.id, etiqueta: e.etiqueta, ubicacion: e.ubicacion, estado: e.estado || "Activo", reservable: e.reservable,
      bloqueo: bloqueoActual ? { hasta: fechaTexto_(bloqueoActual.hasta), motivo: bloqueoActual.motivo } : null,
      uso: actual ? {
        nombre: actual.row[2] ? actual.row[2].toString() : "",
        correo: actual.row[4] ? actual.row[4].toString() : "",
        actividad: actual.row[12] ? actual.row[12].toString() : "",
        fin: actual.fin.toISOString(),
        desatendido: !!(actual.row[COL_DESATENDIDO - 1]),
        mensaje: actual.row[COL_MENSAJE - 1] ? actual.row[COL_MENSAJE - 1].toString() : ""
      } : null,
      proximaReserva: proxima ? proxima.inicio.toISOString() : null
    };
  });
}

/**
 * Reserva rápida desde la ficha: empieza AHORA y dura una de las duraciones permitidas.
 * Usa los datos de la última reserva de la sesión y delega en registrarReserva (misma validación,
 * mismo bloqueo, misma comprobación de disponibilidad, misma idempotencia y mismo correo).
 */
function reservaRapida(assetId, minutos, tipoActividad, detalle, desatendido, mensaje, idSolicitud) {
  var sesion = obtenerEmailActivo_();
  if (!sesion) return { exito: false, mensaje: "No se pudo identificar su sesión. Abra la aplicación iniciando sesión con su cuenta institucional @unal.edu.co." };
  var eq = buscarEquipoPorId_(assetId);
  if (!eq) return { exito: false, mensaje: "No se encontró el equipo." };
  minutos = Number(minutos);
  if (DURACIONES_RAPIDAS_MIN.indexOf(minutos) === -1) return { exito: false, mensaje: "Duración no válida." };

  var perfil = obtenerMiPerfil();
  if (!perfil.ok || !perfil.datos) {
    return { exito: false, mensaje: "La reserva rápida usa los datos de su última reserva. Haga primero una con el formulario completo y la próxima vez será de un toque." };
  }
  var d = perfil.datos;
  var zona = Session.getScriptTimeZone();
  var ini = new Date();
  var fin = new Date(ini.getTime() + minutos * 60000);
  return registrarReserva({
    tipoUsuario: d.programa === "Profesor/Investigador" ? "Docente/Investigador" : "Estudiante",
    nombre: d.nombre, cedula: d.cedula, correo: sesion, programa: d.programa, matricula: d.matricula || "N/A",
    fechaInicio: Utilities.formatDate(ini, zona, "yyyy-MM-dd"), horaInicio: Utilities.formatDate(ini, zona, "HH:mm"),
    fechaFin: Utilities.formatDate(fin, zona, "yyyy-MM-dd"), horaFin: Utilities.formatDate(fin, zona, "HH:mm"),
    equipos: [eq.etiqueta], tipoActividad: tipoActividad, detalleActividad: detalle,
    idSolicitud: idSolicitud, desatendido: desatendido === true, mensaje: mensaje
  });
}

/** Diagnóstico N3 (solo lectura): validación de bloqueos, enlace de calendario y duraciones. */
function pruebasN3() {
  var r = [];
  function t(n, ok) { r.push((ok ? "OK    " : "FALLA ") + n); }
  var ahora = new Date();
  var en2h = fechaTexto_(new Date(ahora.getTime() + 2 * 3600000));
  var en1h = fechaTexto_(new Date(ahora.getTime() + 3600000));
  t("bloqueo válido", validarBloqueo_(en1h, en2h, "Revisión de disco", ahora).ok === true);
  t("acepta formato datetime-local (con T)", validarBloqueo_(en1h.replace(" ", "T"), en2h.replace(" ", "T"), "Revisión", ahora).ok === true);
  t("fin anterior al inicio rechazado", validarBloqueo_(en2h, en1h, "Revisión", ahora).ok === false);
  t("bloqueo en el pasado rechazado", validarBloqueo_("2020-01-01 08:00", "2020-01-01 10:00", "Revisión", ahora).ok === false);
  t("sin motivo rechazado", validarBloqueo_(en1h, en2h, "  ", ahora).ok === false);
  t("motivo de 201 caracteres rechazado", validarBloqueo_(en1h, en2h, new Array(202).join("a"), ahora).ok === false);
  t("fecha mal formada rechazada", validarBloqueo_("mañana", en2h, "Revisión", ahora).ok === false);
  var u = urlGoogleCalendar_("Reserva LADME: X", "2031-03-01", "08:00", "2031-03-01", "10:00", "d");
  t("enlace de calendario con fechas correctas", u.indexOf("dates=20310301T080000/20310301T100000") !== -1 && u.indexOf("calendar.google.com") !== -1);
  t("duraciones rápidas: 1, 2, 4, 8, 12 y 24 h", DURACIONES_RAPIDAS_MIN.join() === "60,120,240,480,720,1440");
  Logger.log(r.join("\n") + "\n\nBloqueos vigentes en la hoja: " + leerBloqueos_(true).length);
}

// ============================================================================
// PANEL ADMINISTRADOR
// ============================================================================

function obtenerDatosAdmin(fechaInicio, fechaFin, equipoFiltro) {
  requireAdmin_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(HOJA_RESERVAS);
  var data = sheet ? sheet.getDataRange().getValues() : [];

  var stats = {
    totalReservas: 0, tipoActividad: {}, equiposMasUsados: {}, horasTotales: 0,
    programas: {}, matriculas: {}, eventosCalendario: [], listaEquiposCat: obtenerListaEquipos()
  };

  if (data.length <= 1) return stats;

  var fInicioFiltro = fechaInicio ? new Date(fechaInicio + "T00:00:00") : null;
  var fFinFiltro = fechaFin ? new Date(fechaFin + "T23:59:59") : null;
  var rows = data.slice(1);

  rows.forEach(function(row, index) {
    var numFilaReal = index + 2;
    if (esReservaCancelada_(row)) return; // el panel operativo no muestra canceladas
    var resStart = new Date(Utilities.formatDate(new Date(row[7]), Session.getScriptTimeZone(), "yyyy-MM-dd") + "T" + formatHoraStr(row[8]) + ":00");
    var resEnd = new Date(Utilities.formatDate(new Date(row[9]), Session.getScriptTimeZone(), "yyyy-MM-dd") + "T" + formatHoraStr(row[10]) + ":00");

    if (fInicioFiltro && resStart < fInicioFiltro) return;
    if (fFinFiltro && resStart > fFinFiltro) return;

    var equiposRowStr = row[11] ? row[11].toString() : "";
    var listaEquipos = equiposRowStr.split(", ").map(function(e){ return e.trim(); });
    if (equipoFiltro && equipoFiltro !== "TODOS" && listaEquipos.indexOf(equipoFiltro) === -1) return;

    stats.totalReservas++;
    stats.horasTotales += (resEnd.getTime() - resStart.getTime()) / 3600000;

    var programaBase = row[5] || "No especificado";
    stats.programas[programaBase] = (stats.programas[programaBase] || 0) + 1;
    stats.matriculas[row[6] || "N/A"] = (stats.matriculas[row[6] || "N/A"] || 0) + 1;
    stats.tipoActividad[row[12] || "N/A"] = (stats.tipoActividad[row[12] || "N/A"] || 0) + 1;

    listaEquipos.forEach(function(eq) { if(eq) stats.equiposMasUsados[eq] = (stats.equiposMasUsados[eq] || 0) + 1; });

    var colorAct = (row[12] || "").toString().startsWith("Otro:") ? "Default" : (row[12] || "");
    var colorAsignado = PALETA_ACTIVIDADES[colorAct] || PALETA_ACTIVIDADES["Default"];

    stats.eventosCalendario.push({
      title: equiposRowStr + " - " + row[2],
      start: resStart.toISOString(), end: resEnd.toISOString(),
      backgroundColor: colorAsignado, borderColor: colorAsignado,
      extendedProps: {
        numFila: numFilaReal,
        idReserva: idDeFila_(row),
        tipoUsuario: row[1], usuario: row[2], cedula: row[3], correo: row[4],
        programa: row[5], matricula: row[6], equipos: equiposRowStr,
        actividad: row[12], detalle: row[13],
        desatendido: row[COL_DESATENDIDO - 1] ? "Sí" : "No",
        mensaje: row[COL_MENSAJE - 1] ? row[COL_MENSAJE - 1].toString() : ""
      }
    });
  });

  stats.horasTotales = Math.round(stats.horasTotales);
  return stats;
}

/**
 * SOLO ADMIN. Equipos no operativos y reservas vigentes/futuras sobre ellos.
 * No modifica nada: el responsable decide qué cancelar.
 */
function obtenerAlertasEstadoAdmin() {
  requireAdmin_();

  var noOperativos = leerCatalogoEquipos_().filter(function (e) { return !e.reservable; });
  var bloqueos = leerBloqueos_(true).sort(function (a, b) { return a.desde - b.desde; });
  var resultado = {
    equiposNoOperativos: noOperativos.map(function (e) { return { equipo: e.etiqueta, estado: e.estado || "(vacío)" }; }),
    bloqueosActivos: bloqueos.map(function (b) {
      return { id: b.id, equipo: b.equipo, desde: fechaTexto_(b.desde), hasta: fechaTexto_(b.hasta), motivo: b.motivo };
    }),
    reservasAfectadas: []
  };
  if (noOperativos.length === 0 && bloqueos.length === 0) return resultado;

  var estados = {};
  noOperativos.forEach(function (e) { estados[e.etiqueta] = e.estado || "(vacío)"; });
  var ahora = new Date();

  todasLasReservas_().forEach(function (r) {
    if (r.fin <= ahora) return; // ya terminada
    for (var k = 0; k < r.equipos.length; k++) {
      var etiqueta = r.equipos[k];
      var causa = null;
      if (estados.hasOwnProperty(etiqueta)) {
        causa = estados[etiqueta];
      } else {
        for (var b = 0; b < bloqueos.length; b++) {
          if (bloqueos[b].equipo === etiqueta && r.inicio < bloqueos[b].hasta && r.fin > bloqueos[b].desde) {
            causa = "Bloqueo de gestión: " + bloqueos[b].motivo;
            break;
          }
        }
      }
      if (causa !== null) {
        resultado.reservasAfectadas.push({
          numFila: r.numFila,
          idReserva: idDeFila_(r.row),
          equipo: etiqueta,
          estado: causa,
          usuario: r.row[2] ? r.row[2].toString() : "",
          correo: r.row[4] ? r.row[4].toString() : "",
          inicio: r.inicio.toISOString(),
          fin: r.fin.toISOString()
        });
        break;
      }
    }
  });

  resultado.reservasAfectadas.sort(function (a, b) { return a.inicio < b.inicio ? -1 : (a.inicio > b.inicio ? 1 : 0); });
  return resultado;
}

/**
 * Cancelación por administrador (panel). Verifica ID de fila, archiva en historial
 * y solo entonces borra.
 */
function cancelarReserva(numFila, motivo, idReserva) {
  var lock = null;
  var tieneLock = false;
  var correoUser, nombreUser, equiposUser, fechaInicio, horaInicio, fechaFin, horaFin;
  var motivoLimpio = (typeof motivo === "string") ? motivo.trim().substring(0, 500) : "";

  try {
    if (!esAdminActual_()) {
      return { exito: false, mensaje: "No tiene permisos de administrador para realizar esta operación." };
    }
    if (!idReserva || !/^RES-\d+$/.test(String(idReserva))) {
      return { exito: false, mensaje: "Solicitud incompleta: falta el identificador de la reserva. Recargue el panel e intente de nuevo." };
    }
    numFila = Number(numFila);
    if (!isFinite(numFila) || Math.floor(numFila) !== numFila) {
      return { exito: false, mensaje: "Fila inválida." };
    }

    lock = LockService.getScriptLock();
    tieneLock = lock.tryLock(LOCK_ESPERA_MS);
    if (!tieneLock) {
      return { exito: false, mensaje: "El sistema está procesando otras solicitudes. Intente de nuevo en unos segundos." };
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_RESERVAS);
    if (!sheet || numFila < 2 || numFila > sheet.getLastRow()) {
      return { exito: false, mensaje: "No se encontró el registro de la reserva. Recargue el panel." };
    }
    asegurarColumnasExtra_(sheet);

    var anchoFila = Math.min(COL_EXTENSIONES, sheet.getMaxColumns());
    var filaDatos = sheet.getRange(numFila, 1, 1, anchoFila).getValues()[0];
    if (idDeFila_(filaDatos) !== String(idReserva)) {
      return { exito: false, mensaje: "La lista de reservas cambió desde que se cargó el panel. Recargue e intente de nuevo; no se canceló nada." };
    }
    if (esReservaCancelada_(filaDatos)) {
      return { exito: false, mensaje: "Esta reserva ya estaba cancelada." };
    }

    nombreUser = filaDatos[2];
    correoUser = filaDatos[4];
    fechaInicio = Utilities.formatDate(new Date(filaDatos[7]), Session.getScriptTimeZone(), "yyyy-MM-dd");
    horaInicio = formatHoraStr(filaDatos[8]);
    fechaFin = Utilities.formatDate(new Date(filaDatos[9]), Session.getScriptTimeZone(), "yyyy-MM-dd");
    horaFin = formatHoraStr(filaDatos[10]);
    equiposUser = filaDatos[11];

    // Archivar PRIMERO; si falla, no se marca nada.
    if (!archivarReserva_(sheet, numFila, "CANCELADA_PANEL", obtenerEmailActivo_(), motivoLimpio)) {
      return { exito: false, mensaje: "No se pudo guardar el historial de la operación, por eso la reserva NO fue cancelada. Intente de nuevo." };
    }

    // Soft-cancel (D-04): la fila queda con Estado = Cancelada y se excluye de disponibilidad.
    sheet.getRange(numFila, COL_ESTADO).setValue("Cancelada");
    sheet.getRange(numFila, COL_FECHA_CANCELACION).setValue(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"));
    sheet.getRange(numFila, COL_MOTIVO_CANCELACION).setValue(motivoLimpio);
    SpreadsheetApp.flush();
  } catch (err) {
    Logger.log("Error en cancelarReserva: " + err.toString());
    return { exito: false, mensaje: "Error al cancelar la reserva. Recargue el panel y verifique su estado." };
  } finally {
    if (tieneLock) {
      try { lock.releaseLock(); } catch (e) { Logger.log("No se pudo liberar el lock: " + e); }
    }
  }

  // Correo, ya fuera del bloqueo
  enviarCorreoCancelacion_(nombreUser, correoUser, equiposUser, fechaInicio, horaInicio, fechaFin, horaFin, motivoLimpio);
  return { exito: true, mensaje: "La reserva fue cancelada y se ha notificado por correo al usuario con el motivo suministrado." };
}

function enviarCorreoCancelacion_(nombre, correo, equipos, fechaInicio, horaInicio, fechaFin, horaFin, motivo) {
  try {
    if (!correo) return;
    var motivoTexto = motivo ? motivo.trim() : "No especificado";

    nombre = escHtml_(nombre);
    equipos = escHtml_(equipos);
    motivoTexto = escHtml_(motivoTexto);

    var htmlCorreo = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e53e3e; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #e53e3e; color: white; padding: 20px; text-align: center;">
          <h2 style="margin:0;">Notificación de Cancelación de Reserva</h2>
          <p style="margin:5px 0 0 0; font-size: 13px;">Laboratorio de Aprendizaje de Datos y Modelado Estadístico - LADME</p>
        </div>
        <div style="padding: 20px; color: #333; line-height: 1.5;">
          <p>Estimado(a) <strong>${nombre || "Usuario"}</strong>,</p>
          <p>Le informamos que su reserva en el laboratorio LADME ha sido <strong>cancelada</strong> por la administración.</p>

          <table style="width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 14px;">
            <tr style="background-color: #fff5f5;"><td style="padding: 8px; border: 1px solid #fed7d7; font-weight: bold;">Equipo(s):</td><td style="padding: 8px; border: 1px solid #fed7d7;">${equipos}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #fed7d7; font-weight: bold;">Inicio:</td><td style="padding: 8px; border: 1px solid #fed7d7;">${fechaInicio} a las ${horaInicio}</td></tr>
            <tr style="background-color: #fff5f5;"><td style="padding: 8px; border: 1px solid #fed7d7; font-weight: bold;">Fin:</td><td style="padding: 8px; border: 1px solid #fed7d7;">${fechaFin} a las ${horaFin}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #fed7d7; font-weight: bold; color: #c53030;">Motivo de Cancelación:</td><td style="padding: 8px; border: 1px solid #fed7d7; color: #c53030; font-weight: bold;">${motivoTexto}</td></tr>
          </table>

          <p style="font-size: 13px; color: #718096;">Si requiere más información o considera que se trata de un ajuste involuntario, por favor comuníquese con la administración del laboratorio.</p>
        </div>
      </div>
    `;

    MailApp.sendEmail({
      to: correo,
      subject: "Cancelación de Reserva - LADME",
      htmlBody: htmlCorreo,
      name: NOMBRE_REMITENTE,
      replyTo: CUENTA_REMITENTE
    });
  } catch (e) {
    Logger.log("Error enviando correo de cancelación: " + e.toString());
  }
}

function autorizarPermisos() { Logger.log("Permisos autorizados."); }

// ============================================================================
// IDENTIDAD EN ENLACES, HISTORIAL E IDEMPOTENCIA
// ============================================================================

/**
 * ¿Puede la sesión actual actuar sobre esta reserva por enlace?
 * Sí si es administrador o si su correo de sesión coincide con el correo de la reserva.
 */
function puedeActuarSobreFila_(rowData) {
  if (!EXIGIR_IDENTIDAD_EN_ENLACES) return true;
  return esTitularOAdmin_(rowData);
}

/** ¿La sesión es el titular de la reserva (correo registrado) o un administrador? Sin interruptores. */
function esTitularOAdmin_(rowData) {
  if (esAdminActual_()) return true;
  var sesion = obtenerEmailActivo_();
  if (!sesion) return false;
  var dueno = rowData[4] ? rowData[4].toString().toLowerCase().trim() : "";
  return dueno !== "" && dueno === sesion;
}

/**
 * Cierra anticipadamente una reserva EN CURSO (fin = ahora), archivando antes la fila original.
 * Llamar DENTRO del bloqueo y después de comprobar permisos.
 * Devuelve { estado: "ok" | "finalizada" | "no_iniciada" | "historial", ... }.
 */
function ejecutarLiberacion_(sheet, rowIndex, rowData, actor, accionHistorial) {
  var zona = Session.getScriptTimeZone();
  var fFinStr = Utilities.formatDate(new Date(rowData[9]), zona, "yyyy-MM-dd");
  var hFinStr = formatHoraStr(rowData[10]);
  var fInStr = Utilities.formatDate(new Date(rowData[7]), zona, "yyyy-MM-dd");
  var hInStr = formatHoraStr(rowData[8]);
  var resStart = new Date(fInStr + "T" + hInStr + ":00");
  var resEnd = new Date(fFinStr + "T" + hFinStr + ":00");
  var ahora = new Date();

  if (ahora >= resEnd) return { estado: "finalizada", fFinStr: fFinStr, hFinStr: hFinStr };
  if (ahora < resStart) return { estado: "no_iniciada", fInStr: fInStr, hInStr: hInStr };
  if (!archivarReserva_(sheet, rowIndex, accionHistorial, actor, "")) return { estado: "historial" };

  var hoyStr = Utilities.formatDate(ahora, zona, "yyyy-MM-dd");
  var horaActualStr = Utilities.formatDate(ahora, zona, "HH:mm");
  sheet.getRange(rowIndex, 10).setValue(hoyStr);
  sheet.getRange(rowIndex, 11).setValue(horaActualStr);
  SpreadsheetApp.flush();
  return { estado: "ok", horaActualStr: horaActualStr };
}

/**
 * Copia la fila rowIndex de Reservas_LADME a Reservas_HISTORIAL (todo como texto,
 * para que nada se interprete como fórmula) y verifica la escritura.
 * Devuelve true solo si quedó confirmada. Llamar SIEMPRE antes de borrar/modificar,
 * y NO continuar si devuelve false. Debe llamarse dentro del bloqueo.
 */
function archivarReserva_(sheetReservas, rowIndex, accion, actor, motivo) {
  try {
    var ss = sheetReservas.getParent();
    var hist = ss.getSheetByName(HOJA_HISTORIAL);
    if (!hist) {
      hist = ss.insertSheet(HOJA_HISTORIAL);
      hist.getRange(1, 1, 1, ENCABEZADOS_HISTORIAL.length)
        .setValues([ENCABEZADOS_HISTORIAL])
        .setFontWeight("bold").setBackground("#6d28d9").setFontColor("#FFFFFF");
      hist.setFrozenRows(1);
    }

    var snap = sheetReservas.getRange(rowIndex, 1, 1, 15).getDisplayValues()[0];
    var fila = [
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"),
      accion, actor || "", motivo || ""
    ].concat(snap);

    var destino = hist.getLastRow() + 1;
    var rango = hist.getRange(destino, 1, 1, fila.length);
    rango.setNumberFormat("@");
    rango.setValues([fila]);
    SpreadsheetApp.flush();

    var idEscrito = hist.getRange(destino, fila.length).getDisplayValue();
    if (String(idEscrito) !== String(snap[14])) {
      Logger.log("Historial: no se confirmó la escritura de " + snap[14] + " (se leyó: " + idEscrito + ")");
      return false;
    }
    return true;
  } catch (err) {
    Logger.log("Error archivando en historial: " + err.toString());
    return false;
  }
}

/** Garantiza las columnas extra de Reservas_LADME (P..V) y sus encabezados. Llamar dentro del bloqueo. */
function asegurarColumnasExtra_(sheet) {
  if (sheet.getMaxColumns() < COL_EXTENSIONES) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), COL_EXTENSIONES - sheet.getMaxColumns());
  }
  [
    [COL_ID_SOLICITUD, "ID Solicitud"],
    [COL_DESATENDIDO, "Proceso Desatendido"],
    [COL_MENSAJE, "Mensaje para quien llegue"]
  ].concat(ENCABEZADOS_RESERVAS_EXTRA)
    .forEach(function (p) {
      var enc = sheet.getRange(1, p[0]);
      if (!enc.getValue()) enc.setValue(p[1]).setFontWeight("bold");
    });
}

/**
 * Escribe una fila de reserva. Las columnas de texto libre se marcan como TEXTO antes de escribir,
 * para que nada de lo que escriba un usuario (por ejemplo, algo que empiece por "=") se interprete como fórmula.
 * Fechas y horas se siguen escribiendo como siempre (Sheets las reconoce).
 */
function escribirFilaReserva_(sheet, fila, valores) {
  [3, 4, 6, 7, 14, COL_MENSAJE, COL_ESTADO, COL_FECHA_CANCELACION, COL_MOTIVO_CANCELACION, COL_EXTENSIONES].forEach(function (c) {
    sheet.getRange(fila, c).setNumberFormat("@");
  });
  sheet.getRange(fila, 1, 1, valores.length).setValues([valores]);
}

/** Busca una reserva ya registrada con ese ID de solicitud. Devuelve datos básicos o null. */
function buscarSolicitudRepetida_(sheet, idSolicitud) {
  var ultima = sheet.getLastRow();
  if (ultima < 2) return null;
  var ids = sheet.getRange(2, COL_ID_SOLICITUD, ultima - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === idSolicitud) {
      var fila = sheet.getRange(i + 2, 1, 1, 15).getValues()[0];
      return {
        rowIndex: i + 2,
        correo: fila[4] ? fila[4].toString().toLowerCase().trim() : "",
        equipo: fila[11] ? fila[11].toString().trim() : "",
        idReserva: idDeFila_(fila)
      };
    }
  }
  return null;
}

// ============================================================================
// PRUEBAS (se ejecutan a mano desde el editor; no escriben nada)
// ============================================================================

/**
 * Pruebas sin efectos secundarios (no escribe en hojas ni envía correos).
 * Ejecutar desde el editor y revisar Ver > Registros de ejecución.
 */
function pruebasP0() {
  var r = [];
  function t(nombre, ok) { r.push((ok ? "OK    " : "FALLA ") + nombre); }

  t("escHtml_ escapa < > \" ' &", escHtml_("<script>\"x\"&'") === "&lt;script&gt;&quot;x&quot;&amp;&#39;");

  var base = {
    tipoUsuario: "Estudiante", nombre: "Ana", cedula: "123", correo: "ana@unal.edu.co",
    programa: "Estadística", matricula: "Primera matrícula",
    fechaInicio: "2030-01-01", horaInicio: "08:00", fechaFin: "2030-01-01", horaFin: "10:00",
    equipos: ["[UNAL-01] Precision 7920 (Dell)"], tipoActividad: "Docencia", detalleActividad: "x"
  };
  function con(c) { var o = JSON.parse(JSON.stringify(base)); for (var k in c) o[k] = c[k]; return o; }

  t("payload válido pasa", validarDatosReserva_(base).ok === true);
  t("null rechazado", validarDatosReserva_(null).ok === false);
  t("tipoActividad con HTML rechazado", validarDatosReserva_(con({ tipoActividad: "<img src=x onerror=alert(1)>" })).ok === false);
  t("tipoUsuario inventado rechazado", validarDatosReserva_(con({ tipoUsuario: "Admin" })).ok === false);
  t("correo de otro dominio rechazado", validarDatosReserva_(con({ correo: "a@gmail.com" })).ok === false);
  t("2 equipos rechazados", validarDatosReserva_(con({ equipos: ["a", "b"] })).ok === false);
  t("0 equipos rechazados", validarDatosReserva_(con({ equipos: [] })).ok === false);
  t("fecha mal formada rechazada", validarDatosReserva_(con({ fechaInicio: "01/01/2030" })).ok === false);
  t("hora 25:00 rechazada", validarDatosReserva_(con({ horaFin: "25:00" })).ok === false);
  t("nombre de 200 caracteres rechazado", validarDatosReserva_(con({ nombre: new Array(201).join("a") })).ok === false);
  t("nombre se recorta (trim)", validarDatosReserva_(con({ nombre: "  Ana  " })).datos.nombre === "Ana");
  t("idDeFila_ usa col. O", idDeFila_([null, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "RES-123"]) === "RES-123");

  Logger.log(r.join("\n") +
    "\n\nCorreo activo: '" + obtenerEmailActivo_() + "'  |  esAdmin: " + esAdminActual_() +
    "\nLa app corre como: '" + cuentaEjecucion_() + "' (esperada: '" + CUENTA_REMITENTE + "')" +
    (cuentaEjecucion_() !== CUENTA_REMITENTE.toLowerCase() ? "  <-- ATENCIÓN: los correos NO salen desde la cuenta del laboratorio" : "  OK") +
    "\n(Si ejecuta esto desde el editor, el correo activo es el de la cuenta que lo ejecuta.)");
}

/** Pruebas puras del P1-B1 (no escriben nada). Ejecutar desde el editor. */
function pruebasP1B1() {
  var r = [];
  function t(n, ok) { r.push((ok ? "OK    " : "FALLA ") + n); }
  var base = {
    tipoUsuario: "Estudiante", nombre: "Ana", cedula: "123", correo: "ana@unal.edu.co",
    programa: "Estadística", matricula: "Primera matrícula",
    fechaInicio: "2030-01-01", horaInicio: "08:00", fechaFin: "2030-01-01", horaFin: "10:00",
    equipos: ["[UNAL-01] X (Dell)"], tipoActividad: "Docencia", detalleActividad: "x"
  };
  function con(c) { var o = JSON.parse(JSON.stringify(base)); for (var k in c) o[k] = c[k]; return o; }

  t("sin idSolicitud sigue siendo válido (cliente viejo)", validarDatosReserva_(base).ok === true);
  t("sin idSolicitud => idSolicitud vacío", validarDatosReserva_(base).datos.idSolicitud === "");
  t("UUID válido aceptado", validarDatosReserva_(con({ idSolicitud: "3f2b8c1e-9a47-4d11-8c3e-1b2a3c4d5e6f" })).ok === true);
  t("ID demasiado corto rechazado", validarDatosReserva_(con({ idSolicitud: "abc" })).ok === false);
  t("ID con HTML rechazado", validarDatosReserva_(con({ idSolicitud: "<img src=x onerror=alert(1)>aaaaaaaaaa" })).ok === false);
  t("ID demasiado largo rechazado", validarDatosReserva_(con({ idSolicitud: new Array(80).join("a") })).ok === false);
  Logger.log(r.join("\n"));
}

/** Diagnóstico del P1-B2 (solo lectura): reglas de Estado y qué equipos quedarían bloqueados. */
function pruebasP1B2() {
  var r = [];
  function t(n, ok) { r.push((ok ? "OK    " : "FALLA ") + n); }

  t("'Activo' reservable", esEstadoReservable_("Activo") === true);
  t("'activo ' (minúsculas y espacio) reservable", esEstadoReservable_("activo ") === true);
  t("vacío reservable", esEstadoReservable_("") === true);
  t("null/undefined reservables", esEstadoReservable_(null) === true && esEstadoReservable_(undefined) === true);
  t("'En mantenimiento' NO reservable", esEstadoReservable_("En mantenimiento") === false);
  t("'Fuera de servicio' NO reservable", esEstadoReservable_("Fuera de servicio") === false);
  t("valor desconocido ('Inactivo') NO reservable", esEstadoReservable_("Inactivo") === false);
  t("typo ('Activ0') NO reservable (falla cerrada)", esEstadoReservable_("Activ0") === false);

  var cat = leerCatalogoEquipos_();
  var bloqueados = cat.filter(function (e) { return !e.reservable; });
  Logger.log(r.join("\n") +
    "\n\nCatálogo real: " + cat.length + " equipos, " + (cat.length - bloqueados.length) + " reservables, " + bloqueados.length + " bloqueados." +
    (bloqueados.length ? "\nBloqueados: " + bloqueados.map(function (e) { return e.etiqueta + " [" + e.estado + "]"; }).join("; ") : "") +
    "\nReservables según obtenerListaEquipos(true): " + obtenerListaEquipos(true).length);
}

/** Diagnóstico N1/N2a (solo lectura): validación de campos nuevos y resolución de IDs de equipos. */
function pruebasN1() {
  var r = [];
  function t(n, ok) { r.push((ok ? "OK    " : "FALLA ") + n); }
  var base = {
    tipoUsuario: "Estudiante", nombre: "Ana", cedula: "123", correo: "ana@unal.edu.co",
    programa: "Estadística", matricula: "Primera matrícula",
    fechaInicio: "2030-01-01", horaInicio: "08:00", fechaFin: "2030-01-01", horaFin: "10:00",
    equipos: ["[UNAL-01] X (Dell)"], tipoActividad: "Docencia", detalleActividad: "x"
  };
  function con(c) { var o = JSON.parse(JSON.stringify(base)); for (var k in c) o[k] = c[k]; return o; }

  t("sin campos nuevos sigue válido (cliente viejo)", validarDatosReserva_(base).ok === true);
  t("desatendido=false por defecto", validarDatosReserva_(base).datos.desatendido === false);
  t("desatendido=true aceptado", validarDatosReserva_(con({ desatendido: true })).datos.desatendido === true);
  t("desatendido como texto rechazado", validarDatosReserva_(con({ desatendido: "sí" })).ok === false);
  t("mensaje válido aceptado", validarDatosReserva_(con({ mensaje: "No apagar" })).datos.mensaje === "No apagar");
  t("saltos de línea del mensaje se aplanan", validarDatosReserva_(con({ mensaje: "a\nb\tc" })).datos.mensaje === "a b c");
  t("mensaje de 141 caracteres rechazado", validarDatosReserva_(con({ mensaje: new Array(142).join("a") })).ok === false);
  t("mensaje no textual rechazado", validarDatosReserva_(con({ mensaje: 5 })).ok === false);
  t("ID con caracteres raros no resuelve equipo", buscarEquipoPorId_("<script>") === null);

  var cat = leerCatalogoEquipos_();
  var resueltos = cat.filter(function (e) { return buscarEquipoPorId_(e.id) !== null; }).length;
  t("todos los IDs del catálogo resuelven a su equipo (" + resueltos + "/" + cat.length + ")", resueltos === cat.length && cat.length > 0);
  var ficha = cat.length ? obtenerFichaEquipo(cat[0].id) : { ok: false };
  t("la ficha del primer equipo se genera", ficha.ok === true);
  t("la ficha NO incluye correo ni nombre (salvo admin)", esAdminActual_() || (!ficha.admin && !(ficha.usoActual && ficha.usoActual.correo)));

  Logger.log(r.join("\n") + "\n\nIDs de equipo en el catálogo: " + cat.map(function (e) { return e.id; }).join(", "));
}

/**
 * Pruebas puras de la política de reservas (D-02) y del soft-cancel (D-04).
 * No escriben en hojas ni envían correos. Ejecutar desde el editor.
 */
function pruebasPolitica() {
  var r = [];
  function t(n, ok) { r.push((ok ? "OK    " : "FALLA ") + n); }
  function horas(h) { return h * 3600000; }
  function fecha(base, h) { return new Date(base.getTime() + horas(h)); }

  var t0 = new Date(2031, 0, 6, 8, 0);

  // --- Reserva base: 168 h ---
  t("base de 1 h aceptada", validarPoliticaBase_(t0, fecha(t0, 1)).ok === true);
  t("base de 168 h aceptada", validarPoliticaBase_(t0, fecha(t0, 168)).ok === true);
  t("base de 168.01 h rechazada", validarPoliticaBase_(t0, fecha(t0, 168.01)).ok === false);
  t("base de 169 h rechazada", validarPoliticaBase_(t0, fecha(t0, 169)).ok === false);
  t("base con fin = inicio rechazada", validarPoliticaBase_(t0, t0).ok === false);
  t("base con fin anterior rechazada", validarPoliticaBase_(t0, fecha(t0, -1)).ok === false);
  t("base con fecha inválida rechazada", validarPoliticaBase_(t0, new Date("x")).ok === false);

  // --- Extensión: una sola, máximo 24 h, total máximo 192 h ---
  var fin168 = fecha(t0, 168);
  t("extensión de 24 h sobre 168 h aceptada",
    validarPoliticaExtension_(t0, fin168, fecha(fin168, 24), 0, false).ok === true);
  t("extensión de 24.01 h rechazada",
    validarPoliticaExtension_(t0, fin168, fecha(fin168, 24.01), 0, false).ok === false);
  t("extensión que deja total 192.01 h rechazada",
    validarPoliticaExtension_(t0, fin168, fecha(fin168, 24.01), 0, false).ok === false);
  t("segunda extensión rechazada",
    validarPoliticaExtension_(t0, fin168, fecha(fin168, 12), 1, false).ok === false);
  t("extensión sin avanzar el fin rechazada",
    validarPoliticaExtension_(t0, fin168, fin168, 0, false).ok === false);
  t("extensión con fin anterior rechazada",
    validarPoliticaExtension_(t0, fin168, fecha(fin168, -1), 0, false).ok === false);
  t("el admin puede superar el tope (queda registrado)",
    validarPoliticaExtension_(t0, fin168, fecha(fin168, 25), 1, true).ok === true);

  var ext = validarPoliticaExtension_(t0, fecha(t0, 48), fecha(t0, 60), 0, false);
  t("extensión reporta 12 h agregadas y 60 h totales", ext.ok && ext.horasAgregadas === 12 && ext.horasTotales === 60);

  // --- Estado / soft-cancel ---
  var filaActiva = new Array(COL_EXTENSIONES); filaActiva[COL_ESTADO - 1] = "Activa";
  var filaVacia = new Array(COL_EXTENSIONES);
  var filaCancelada = new Array(COL_EXTENSIONES); filaCancelada[COL_ESTADO - 1] = "Cancelada";
  t("Estado Activa no es cancelada", esReservaCancelada_(filaActiva) === false);
  t("Estado vacío se trata como Activa", estadoReserva_(filaVacia) === "Activa" && esReservaCancelada_(filaVacia) === false);
  t("Estado Cancelada se detecta (sin distinguir mayúsculas)",
    esReservaCancelada_(filaCancelada) === true &&
    esReservaCancelada_((function () { var f = new Array(COL_EXTENSIONES); f[COL_ESTADO - 1] = "  CANCELADA "; return f; })()) === true);
  t("slice H..V detecta Cancelada", esCanceladaEnSliceH_(filaCancelada.slice(7)) === true);
  t("slice H..V no marca una activa", esCanceladaEnSliceH_(filaActiva.slice(7)) === false);

  Logger.log(r.join("\n"));
}