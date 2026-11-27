import { invocar, escuchar, fijarDesfase, cuenta, progreso, textoHora, textoReloj, esc, ICONOS, DIBUJO_NFC, LOGO } from './comun.js';

// ------------------------------------------------------------------ estado
const isla = document.getElementById('isla');

// Linux (WebKitGTK): una ventana transparente no siempre borra lo que la isla deja de cubrir. Crecer no deja
// rastro (cada cuadro cubre más), encogerse o desaparecer sí. Así que en Linux la isla crece con animación y se
// encoge de golpe, y justo después Faro rehace la ventana (isla_repintar) para borrar el único cuadro viejo.
const LINUX = document.documentElement.classList.contains('linux');
let antes = null; // { w, h, oculta, sombra } del último dibujo
const capas = Object.fromEntries([...isla.querySelectorAll('.capa')].map((c) => [c.dataset.capa, c]));

let paquete = null;
let ui = 'compacta';          // 'mini' | 'compacta' | 'abierta'
let accion = null;            // panel: 'reservar' | 'llegada' | 'extender' | 'liberar' | 'reportar' | 'ayuda' | 'hecho' | 'personal'
let resultado = null;         // { ok, texto } de la última acción hecha en la isla
let haciendo = false;         // una acción en curso (botones deshabilitados)
let aviso = '';               // mensaje bajo el panel (error o confirmación)
let confirmar = '';           // botón que pide un segundo clic ('retirar' | 'limpiar')
const salir = { proceso: false, mensaje: '', vuelvo: 30 }; // panel «Salir un rato»
let qrLlegada = null;         // { svg, cambia_en } del QR de llegada (cambia cada 30 s)
let anuncioVisto = '';
let obligatorioVisto = null;
let limpiezaDescartada = '';
let fijaHasta = 0;            // la isla abierta no se cierra sola antes de este momento
let dentro = false;           // el cursor está sobre la isla (lo informa isla.rs)
let completa = false;         // hay una app a pantalla completa
let arrastrando = false;
let insistiaAntes = false;
let ultimaInsistencia = 0;
let estadoAntes = null;
const qrCache = {};
const html = { mini: '', compacta: '', abierta: '' };
const timers = {};

const PAUSA_MINI = 3500;      // compacta → mini sin el cursor encima
const PAUSA_CERRAR = 2600;    // abierta → se cierra sola sin el cursor encima
const AVISO_CAMBIO = 5000;    // al cambiar de estado se muestra compacta un rato
const PAUSA_PANEL = 60_000;   // con un QR o la clave en pantalla: hay tiempo para sacar el celular

// Solo dos acciones llevan QR (reservar y confirmar la llegada, que se hacen con la cuenta de la persona);
// extender, liberar, reportar y pedir ayuda se hacen aquí mismo, sin el celular.
const ACCIONES = {
  reservar: { texto: 'Reservar este equipo', titulo: 'Reserva desde tu celular', cuerpo: 'Escanea, elige hasta qué hora y el equipo queda a tu nombre.', icono: ICONOS.mas, principal: true, qr: true },
  llegada:  { texto: 'Confirmar asistencia', titulo: 'Confirma tu asistencia', cuerpo: 'En tu celular: LADME → «Confirmar asistencia». Escribe este código o escanea el QR.', icono: ICONOS.check, principal: true, qr: true },
  extender: { texto: 'Extender', icono: ICONOS.reloj, principal: true },
  liberar:  { texto: 'Liberar', icono: ICONOS.salir },
  reportar: { texto: 'Reportar falla', icono: ICONOS.falla },
  ayuda:    { texto: 'Pedir ayuda', icono: ICONOS.ayuda },
  salir:    { texto: 'Salir un rato', icono: ICONOS.candado },
};
// Tipos de falla que se reportan con un toque (el equipo está encendido: «No enciende» no aplica).
const CATEGORIAS = ['Lento o se congela', 'Software', 'Pantalla o periféricos', 'Red o internet', 'Otro'];
// Rutas que existen en la PWA: la reserva va con ?equipo= y lo demás abre la ficha del equipo.
const ruta = (a, codigo) => {
  const c = encodeURIComponent(codigo);
  return a === 'reservar' ? `/reservar?equipo=${c}` : `/equipo/${c}?accion=${a}`;
};
// «ladme.app/e/UNAL-05» para escribir a mano si no hay cámara a mano.
const enlaceCorto = (codigo) => {
  const base = (paquete?.url_base ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  return base && codigo ? `${base}/e/${codigo}` : '';
};

const vista = () => paquete?.vista ?? { estado: 'conectando', titulo: 'Conectando con LADME', detalle: '', en_linea: false };
const urgente = (v = vista()) => !!v.insistir || ['por_terminar', 'gracia', 'libre_en_uso'].includes(v.estado);

function accionesDe(estado, v = vista()) {
  if (estado === 'reservado' || estado === 'por_terminar') {
    // Liberar y salir un rato piden la llegada confirmada (lo exige el servidor).
    return v.llegada_pendiente ? ['llegada', 'extender', 'reportar', 'ayuda'] : ['extender', 'salir', 'liberar', 'reportar', 'ayuda'];
  }
  if (estado === 'libre' || estado === 'libre_en_uso' || estado === 'gracia' || estado === 'compartido') return ['reservar', 'reportar', 'ayuda'];
  return ['reportar', 'ayuda'];
}

/** Cabecera de los paneles: volver, título y el tiempo con su aro. */
function cabeceraPanel(v, titulo) {
  const resto = restante(v);
  return `<div class="cab-panel">
      <button class="redondo chico" data-volver aria-label="Volver" ${haciendo ? 'disabled' : ''}>${ICONOS.volver}</button>
      <span class="cab-panel__titulo">${titulo}</span>
      ${v.cuenta_hasta ? `<span class="cab-panel__tiempo">${aro(resto, 18)}<span class="num" data-vivo="valor">${valorCorto(v)}</span></span>` : ''}
    </div>`;
}

const masMinutos = (v, m) => (v.cuenta_hasta ? textoHora(new Date(new Date(v.cuenta_hasta).getTime() + m * 60_000).toISOString()) : '');

/** Paneles de las acciones que se hacen en la isla. */
function htmlPanel(v) {
  const dis = haciendo ? 'disabled' : '';
  switch (accion) {
    case 'extender':
      return `${cabeceraPanel(v, 'Extender')}
        <div class="dos">
          <button class="opcion-grande" data-hacer="extender" data-minutos="30" ${dis}><b>+30 min</b><span>hasta ${masMinutos(v, 30)}</span></button>
          <button class="opcion-grande" data-hacer="extender" data-minutos="60" ${dis}><b>+1 h</b><span>hasta ${masMinutos(v, 60)}</span></button>
        </div>
        <p class="nota">Solo si nadie más reservó después. Te llega el aviso al celular.</p>`;
    case 'liberar':
      return `${cabeceraPanel(v, '¿Terminaste?')}
        <p class="nota">El equipo queda libre para otra persona. Guarda tu trabajo antes.</p>
        <div class="fila-botones">
          <button class="boton grande peligro" data-hacer="liberar" ${dis}>${ICONOS.salir} Liberar ahora</button>
          <button class="boton grande" data-volver ${dis}>Cancelar</button>
        </div>`;
    case 'reportar':
      return `${cabeceraPanel(v, '¿Qué le pasa?')}
        <div class="chips">${CATEGORIAS.map((c) => `<button class="boton chip" data-hacer="reportar" data-categoria="${esc(c)}" ${dis}>${esc(c)}</button>`).join('')}</div>
        <p class="nota">Va al personal con un diagnóstico del equipo (red, disco, procesador).</p>`;
    case 'ayuda':
      return `${cabeceraPanel(v, '¿Necesitas ayuda?')}
        <p class="nota">Avisamos al personal que en ${esc(v.equipo ?? 'este equipo')} necesitan ayuda.</p>
        <button class="boton grande principal ancho" data-hacer="ayuda" ${dis}>${ICONOS.ayuda} Avisar al personal</button>`;
    case 'salir':
      return `${cabeceraPanel(v, 'Salir un rato')}
        <p class="nota">La pantalla se tapa y nada se cierra. La quitas con el código de tu reserva o el QR.</p>
        <label class="interruptor">
          <span><b>Dejo un proceso corriendo</b><small>Se muestra tu mensaje en la pantalla</small></span>
          <input type="checkbox" data-salir-proceso ${salir.proceso ? 'checked' : ''} />
          <i aria-hidden="true"></i>
        </label>
        ${salir.proceso ? `<input class="texto" data-campo="salir-mensaje" maxlength="120" placeholder="Ej.: entrenando un modelo, no apagar" value="${esc(salir.mensaje)}" aria-label="Mensaje en la pantalla" />` : ''}
        <div class="vuelvo"><span>Vuelvo en</span>${[[0, '—'], [30, '30 min'], [60, '1 h'], [120, '2 h']].map(([m, t]) =>
          `<button class="boton chip ${salir.vuelvo === m ? 'activo' : ''}" data-vuelvo="${m}">${t}</button>`).join('')}</div>
        ${aviso ? `<p class="aviso-error">${esc(aviso)}</p>` : ''}
        <button class="boton grande principal ancho" data-hacer="salir" ${dis}>${ICONOS.candado} Bloquear pantalla</button>`;
    case 'hecho':
      return `<div class="resultado ${resultado?.ok ? 'ok' : 'error'}">
          <span class="resultado__icono">${resultado?.ok ? ICONOS.check : ICONOS.falla}</span>
          <p><b>${resultado?.ok ? 'Listo' : 'No se pudo'}</b>${esc(resultado?.texto ?? '')}</p>
          <button class="boton" data-volver>Volver</button>
        </div>`;
    default:
      return '';
  }
}

/** Lo que Faro explica sobre sí mismo: sin conexión o reloj desfasado. */
function htmlAvisosFaro() {
  const partes = [];
  const sinRed = paquete?.sin_red_seg;
  if (sinRed != null) {
    const min = Math.max(1, Math.round(sinRed / 60));
    partes.push(`<div class="aviso-faro">${ICONOS.sinRed}<span><strong>Sin conexión con LADME${sinRed >= 60 ? ` desde hace ${min} min` : ''}.</strong>
      Faro sigue con la última información; las acciones vuelven cuando haya red. Revisa el cable o el wifi.</span></div>`);
  }
  const desfase = Math.abs(paquete?.desfase_ms ?? 0);
  if (desfase > 120_000) {
    partes.push(`<div class="aviso-faro">${ICONOS.reloj}<span><strong>El reloj de este equipo está desfasado ${Math.round(desfase / 60_000)} min.</strong>
      Faro usa la hora del servidor. Avísale al personal.</span></div>`);
  }
  return partes.join('');
}

function etiqueta(v) {
  switch (v.estado) {
    case 'reservado': return v.titular ? `Reservado · ${esc(v.titular)}` : 'Reservado';
    case 'por_terminar': return 'Termina pronto';
    case 'gracia': return 'Reserva terminada';
    case 'libre': return v.siguiente ? `Libre hasta ${textoHora(v.siguiente)}` : 'Disponible';
    case 'libre_en_uso': return 'Sin reserva';
    case 'desbloqueado': return v.titulo === 'Clase en curso' ? 'Clase en curso' : 'Uso libre';
    case 'compartido': return 'Uso compartido';
    case 'mantenimiento': return esc(v.titulo);
    case 'ocupado': return 'Bloqueado';
    default: return 'Conectando…';
  }
}

function queCuenta(v) {
  switch (v.estado) {
    case 'reservado': case 'por_terminar': return 'restantes';
    case 'gracia': return v.modo === 'bloquear' ? 'para el bloqueo' : 'de gracia';
    case 'desbloqueado': return 'de uso libre';
    case 'compartido': return 'de uso compartido';
    case 'ocupado': return 'hasta que termine';
    case 'libre': case 'libre_en_uso': return 'para la próxima reserva';
    default: return '';
  }
}

const valorCorto = (v) => (v.cuenta_hasta && v.estado !== 'libre' ? cuenta(v.cuenta_hasta) : textoReloj());

// ------------------------------------------------------------------ contenido de cada capa
/** Fracción que queda (1 = todo, 0 = nada) de la ocupación o del rato libre. */
function restante(v) {
  const p = progreso(v.desde, v.cuenta_hasta);
  return p === null ? 1 : 1 - p;
}

/** Aro de progreso: lo que queda, en el color del estado. */
function aro(fraccion, tam, px = tam > 40 ? 6 : 2.4) {
  const grosor = (px * 18) / tam; // el grosor en píxeles, pasado a la escala del dibujo (18)
  const r = 9 - grosor / 2;
  const c = 2 * Math.PI * r;
  return `<svg class="aro" width="${tam}" height="${tam}" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r="${r}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="${grosor}"/>
      <circle data-vivo="aro" data-c="${c.toFixed(3)}" cx="9" cy="9" r="${r}" fill="none" stroke="var(--c)" stroke-width="${grosor}" stroke-linecap="round"
        stroke-dasharray="${c.toFixed(3)}" stroke-dashoffset="${(c * (1 - fraccion)).toFixed(3)}"/>
    </svg>`;
}

function htmlMini(v) {
  return `<div class="mini">${aro(restante(v), 14)}<span class="valor num" data-vivo="valor">${valorCorto(v)}</span></div>`;
}

function htmlCompacta(v) {
  const extra = v.llegada_pendiente ? `<span class="marca-compacta ambar">Confirma asistencia</span>`
    : v.anuncio ? `<span class="marca-compacta">${ICONOS.megafono}</span>` : '';
  return `<div class="compacta">
      ${aro(restante(v), 18)}
      <span class="codigo">${esc(v.equipo ?? 'Faro')}</span>
      ${extra}
      ${v.en_linea ? '' : `<span class="marca-compacta" title="Sin conexión">${ICONOS.sinRed}</span>`}
      <span class="valor num" data-vivo="valor">${valorCorto(v)}</span>
    </div>`;
}

/** Lo que va arriba a la derecha del aro: quién, hasta cuándo y una línea. */
function encabezado(v) {
  const hasta = v.cuenta_hasta ? textoHora(v.cuenta_hasta) : '';
  switch (v.estado) {
    case 'reservado':
      return { kicker: v.titular ? `Reserva de ${esc(v.titular)}` : 'Reservado', titulo: `Hasta las ${hasta}`,
               linea: v.llegada_pendiente ? (v.llegada_hasta ? `Confirma tu asistencia antes de las ${textoHora(v.llegada_hasta)}` : 'Confirma tu asistencia') : 'Llegada confirmada' };
    case 'por_terminar':
      return { kicker: 'Termina pronto', titulo: `Hasta las ${hasta}`, linea: 'Guarda tu trabajo o extiende' };
    case 'libre':
      return { kicker: 'Libre', titulo: v.siguiente ? `Libre hasta las ${textoHora(v.siguiente)}` : 'Disponible',
               linea: paquete?.nfc ? 'Acerca tu celular a la base del monitor' : 'Resérvalo desde tu celular' };
    case 'libre_en_uso':
      return { kicker: 'Sin reserva', titulo: 'Resérvalo para usarlo', linea: paquete?.nfc ? 'O acerca tu celular a la base del monitor' : '' };
    default:
      return { kicker: etiqueta(v), titulo: esc(v.titulo), linea: esc(v.detalle ?? '') };
  }
}

function htmlAbierta(v) {
  const codigo = v.equipo ?? '';
  let cuerpo;
  if (accion === 'personal') {
    cuerpo = `${cabeceraPanel(v, 'Personal del laboratorio')}
      <p class="nota">Clave de emergencia o temporal: desbloquea este equipo. Solo la de emergencia quita Faro.</p>
      <input class="campo" data-clave type="password" autocomplete="off" placeholder="Clave" aria-label="Clave del personal" />
      ${aviso ? `<p class="aviso-error">${esc(aviso)}</p>` : ''}
      <div class="fila-botones">
        <button class="boton grande principal" data-desbloquear>${ICONOS.candado} Desbloquear</button>
        <button class="boton grande ${confirmar === 'retirar' ? 'peligro' : ''}" data-retirar>${ICONOS.papelera} ${confirmar === 'retirar' ? '¿Seguro?' : 'Quitar Faro'}</button>
      </div>`;
  } else if (accion && !ACCIONES[accion]?.qr) {
    cuerpo = htmlPanel(v);
  } else if (accion) {
    const r = ruta(accion, codigo);
    const svg = accion === 'llegada' ? qrLlegada?.svg : qrCache[r];
    const corto = accion === 'llegada' ? '' : enlaceCorto(codigo);
    cuerpo = `${cabeceraPanel(v, accion === 'llegada' ? 'Confirma tu asistencia' : 'Reservar')}
      <div class="panel-qr">
        <div class="qr">${svg ?? ''}</div>
        <div class="panel-qr__lado">
          ${accion === 'llegada' ? `<span class="nota">Escanea, o escribe en tu celular</span>
            ${qrLlegada?.numero ? `<div class="codigo-llegada num" aria-label="Código ${esc(qrLlegada.numero)}">${esc(qrLlegada.numero.slice(0, 3))}<span></span>${esc(qrLlegada.numero.slice(3))}</div>` : ''}
            <div class="barra fina"><i data-vivo="qr-llegada"></i></div>
            ${v.llegada_hasta ? `<span class="nota chica">Antes de las ${textoHora(v.llegada_hasta)}</span>` : ''}`
          : `<span class="nota">Escanea y elige hasta qué hora</span>
            ${paquete?.nfc ? `<span class="nota chica">${ICONOS.nfc ?? ''} O acerca tu celular a la base del monitor</span>` : ''}
            ${corto ? `<span class="nota chica">Sin cámara: <span class="num seleccionable">${esc(corto)}</span></span>` : ''}`}
          ${aviso ? `<p class="aviso-error">${esc(aviso)}</p>` : ''}
        </div>
      </div>`;
  } else {
    const e = encabezado(v);
    const acciones = accionesDe(v.estado, v);
    const primera = ACCIONES[acciones[0]]?.principal ? acciones[0] : null;
    const resto = primera ? acciones.slice(1) : acciones;
    cuerpo = `
      <div class="heroe">
        <div class="heroe__aro">${aro(restante(v), 104)}
          <div class="heroe__centro">${v.cuenta_hasta && v.estado !== 'libre'
            ? `<span class="num" data-vivo="corto">${cuentaCorta(v.cuenta_hasta)}</span><small>quedan</small>`
            : `<span class="heroe__icono">${v.estado === 'libre' && paquete?.nfc ? (ICONOS.nfc ?? '') : LOGO}</span>`}</div>
        </div>
        <div class="heroe__texto">
          <span class="kicker">${e.kicker} · ${esc(codigo)}</span>
          <h2 class="titulo">${e.titulo}</h2>
          ${e.linea ? `<span class="linea">${e.linea}</span>` : ''}
        </div>
      </div>
      ${v.mensaje ? `<div class="mensaje">«${esc(v.mensaje)}»</div>` : ''}
      ${v.limpieza_desde && limpiezaDescartada !== v.limpieza_desde ? `<div class="tarjeta-aviso">
          <p><b>¿Borrar tus archivos?</b>Los de Descargas y Escritorio de esta reserva, para que el siguiente no los vea.</p>
          ${aviso ? `<p class="aviso-error">${esc(aviso)}</p>` : ''}
          <div class="fila-botones">
            <button class="boton ${confirmar === 'limpiar' ? 'peligro' : 'principal'}" data-limpiar>${ICONOS.papelera} ${confirmar === 'limpiar' ? '¿Seguro? No se deshace' : 'Borrar'}</button>
            <button class="boton" data-no-limpiar>No, gracias</button>
          </div>
        </div>` : ''}
      ${v.estado === 'por_terminar' ? `<div class="tarjeta-aviso"><p><b>Antes de irte</b>Guarda tu trabajo, cierra tu correo y tus cuentas, y libera el equipo si ya terminaste.</p></div>` : ''}
      <div class="barra-acciones">
        ${primera ? `<button class="boton grande principal" data-accion="${primera}">${ACCIONES[primera].icono} ${ACCIONES[primera].texto === 'Reservar este equipo' ? 'Reservar' : ACCIONES[primera].texto}</button>` : ''}
        ${resto.map((k) => `<button class="redondo" data-accion="${k}" aria-label="${ACCIONES[k].texto}" title="${ACCIONES[k].texto}">${ACCIONES[k].icono}</button>`).join('')}
      </div>`;
  }
  return `<div class="abierta">
      ${accion ? '' : `<button class="cerrar" data-cerrar aria-label="Cerrar">${ICONOS.cerrar}</button>`}
      ${htmlAvisosFaro()}
      ${v.anuncio ? `<div class="anuncio${v.confirmar_anuncio ? ' obligatorio' : ''}">
          <span class="anuncio__de">${ICONOS.megafono} Aviso del laboratorio</span>
          <span class="anuncio__texto">${esc(v.anuncio)}</span>
          ${v.confirmar_anuncio ? `<button class="boton grande principal ancho" data-entendido="${v.confirmar_anuncio}">Entendido</button>
          <small>Si nadie lo confirma, la pantalla se suspende</small>` : ''}
        </div>` : ''}
      ${v.compartido ? `<div class="protegido">${ICONOS.candado}<span><b>Uso compartido${v.compartido.titular ? ` de ${esc(v.compartido.titular)}` : ''}.</b>
        ${v.compartido.protegidos?.length ? `No cierres ${esc(v.compartido.protegidos.join(', '))}.` : 'No cierres los programas abiertos.'}
        No reinicies ni cierres la sesión.${v.compartido.nota ? ` «${esc(v.compartido.nota)}»` : ''}</span></div>` : ''}
      ${v.espera > 0 && (v.estado === 'por_terminar' || v.estado === 'reservado') ? `<div class="espera">${ICONOS.reloj}<span>${v.espera === 1 ? '1 persona espera' : `${v.espera} personas esperan`} un equipo. Si terminaste, libéralo.</span></div>` : ''}
      ${cuerpo}
      <div class="pie"><span class="pie__marca">${LOGO}Faro</span>
        <span class="pie__der"><span class="num" data-vivo="hora">--</span>${paquete?.clave_disponible && accion !== 'personal'
          ? `<button class="link-pie" data-personal aria-label="Personal del laboratorio" title="Personal del laboratorio">${ICONOS.llave}</button>` : ''}</span></div>
    </div>`;
}

/** «1:13» (horas:minutos) o «12 min» dentro del aro. */
function cuentaCorta(hasta) {
  const s = Math.max(0, Math.round((new Date(hasta).getTime() - Date.now()) / 1000));
  if (s < 3600) return `${Math.ceil(s / 60)} min`;
  const h = Math.floor(s / 3600);
  return `${h}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ dibujo
function oculta() {
  return completa && !urgente() && ui !== 'abierta';
}

function dibujar() {
  const v = vista();
  isla.dataset.estado = v.estado;
  isla.dataset.ui = ui;
  isla.classList.toggle('pulso', urgente(v) || v.estado === 'reservado');
  isla.classList.toggle('urgente', urgente(v));
  isla.classList.toggle('oculta', oculta());

  // Solo se reemplaza el HTML de una capa si cambió (las cifras vivas se actualizan aparte).
  const nuevo = { mini: htmlMini(v), compacta: htmlCompacta(v), abierta: htmlAbierta(v) };
  for (const k of Object.keys(capas)) {
    if (nuevo[k] !== html[k]) {
      // Lo escrito en la clave sobrevive a que se redibuje la isla.
      const campo = capas[k].querySelector('input[data-clave]');
      const valor = campo?.value ?? '';
      const conFoco = campo && document.activeElement === campo;
      capas[k].innerHTML = nuevo[k];
      html[k] = nuevo[k];
      const otro = capas[k].querySelector('input[data-clave]');
      if (otro) { otro.value = valor; if (conFoco || accion === 'personal') otro.focus(); }
    }
    capas[k].classList.toggle('activa', k === ui);
  }

  for (const el of isla.querySelectorAll('[data-vivo="hora"]')) el.textContent = textoReloj();
  if (qrLlegada) for (const el of isla.querySelectorAll('[data-vivo="qr-llegada"]')) el.style.width = `${(Math.max(0, qrLlegada.cambia_en) / 30) * 100}%`;

  const activa = capas[ui];
  const w = Math.ceil(activa.offsetWidth);
  const h = Math.ceil(activa.offsetHeight);
  const ahora = { w, h, oculta: oculta(), sombra: urgente(v) && ui !== 'abierta' };
  const encoge = LINUX && antes && (w < antes.w || h < antes.h || (ahora.oculta && !antes.oculta) || (antes.sombra && !ahora.sombra));
  if (encoge) isla.classList.add('de-golpe');
  isla.style.setProperty('--w', `${w}px`);
  isla.style.setProperty('--h', `${h}px`);
  isla.style.setProperty('--r', ui === 'abierta' ? '28px' : `${Math.round(h / 2)}px`);
  if (encoge) {
    void isla.offsetWidth; // aplica el tamaño nuevo sin transición
    // Cuando ese cuadro ya está en pantalla, se vuelven a permitir las transiciones y se limpia la ventana.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      isla.classList.remove('de-golpe');
      invocar('isla_repintar');
    }));
  }
  antes = ahora;

  // Solo la isla recibe clics: se informa su rectángulo (con un margen pequeño) a la ventana.
  const m = 4;
  if (oculta()) invocar('isla_zona', { x: 0, y: 0, ancho: 0, alto: 0 });
  else invocar('isla_zona', { x: (window.innerWidth - w) / 2 - m, y: 0, ancho: w + 2 * m, alto: h + m });
  programar();
}

function cambiar(nuevo) {
  clearTimeout(timers.crecer);
  if (nuevo === ui) return;
  if (nuevo !== 'abierta') { accion = null; aviso = ''; confirmar = ''; fijaHasta = 0; resultado = null; }
  ui = nuevo;
  dibujar();
}

// Temporizadores: encogerse sola, cerrarse sola, crecer al pasar el mouse.
function programar() {
  clearTimeout(timers.reposo);
  if (arrastrando || dentro) return;
  if (ui === 'abierta') {
    const pausa = Math.max(accion ? PAUSA_PANEL : PAUSA_CERRAR, fijaHasta - Date.now());
    timers.reposo = setTimeout(() => cambiar(urgente() ? 'compacta' : 'mini'), pausa);
  } else if (ui === 'compacta' && !urgente()) {
    timers.reposo = setTimeout(() => cambiar('mini'), PAUSA_MINI);
  }
}

function alDentro(d) {
  dentro = d;
  clearTimeout(timers.crecer);
  if (d && ui === 'mini') timers.crecer = setTimeout(() => { if (dentro && ui === 'mini') cambiar('compacta'); }, 90);
  programar();
}

// ------------------------------------------------------------------ datos de Faro
async function alRecibir(p) {
  paquete = p;
  fijarDesfase(p.desfase_ms);
  const v = vista();
  const anuncioNuevo = v.anuncio && v.anuncio !== anuncioVisto;
  const limpiezaNueva = v.limpieza_desde && v.limpieza_desde !== limpiezaDescartada && html.abierta.indexOf('data-limpiar') < 0;
  if (v.anuncio) anuncioVisto = v.anuncio;
  // Anuncio obligatorio: la isla queda abierta hasta que alguien lo confirme.
  const obligatorioNuevo = v.confirmar_anuncio && v.confirmar_anuncio !== obligatorioVisto;
  obligatorioVisto = v.confirmar_anuncio ?? null;
  if (v.insistir && (!insistiaAntes || Date.now() - ultimaInsistencia > 5 * 60_000)) {
    ultimaInsistencia = Date.now();
    accion = null;
    ui = 'abierta';
  } else if (obligatorioNuevo && accion !== 'personal') {
    accion = null;
    ui = 'abierta';
    fijaHasta = Date.now() + 60 * 60_000;
  } else if ((anuncioNuevo || limpiezaNueva) && accion !== 'personal') {
    // Un anuncio del laboratorio o la oferta de borrar archivos: se muestra abierta un rato.
    accion = null;
    ui = 'abierta';
    fijaHasta = Date.now() + 20_000;
  } else if (estadoAntes !== null && estadoAntes !== v.estado && ui === 'mini') {
    ui = 'compacta'; // anuncia el cambio y vuelve a encogerse después
    clearTimeout(timers.reposo);
    setTimeout(programar, AVISO_CAMBIO - PAUSA_MINI);
  }
  if (estadoAntes !== v.estado && accion !== 'personal' && accion !== 'hecho') accion = null;
  if (accion === 'llegada' && !v.llegada_pendiente) accion = null;
  insistiaAntes = !!v.insistir;
  estadoAntes = v.estado;
  dibujar();
}

// Lo que cambia cada segundo se actualiza sin volver a dibujar.
setInterval(() => {
  const v = paquete?.vista;
  if (!v) return;
  for (const el of isla.querySelectorAll('[data-vivo="valor"]')) el.textContent = valorCorto(v);
  for (const el of isla.querySelectorAll('[data-vivo="grande"]')) if (v.cuenta_hasta) el.textContent = cuenta(v.cuenta_hasta);
  for (const el of isla.querySelectorAll('[data-vivo="corto"]')) if (v.cuenta_hasta) el.textContent = cuentaCorta(v.cuenta_hasta);
  const queda = restante(v);
  for (const el of isla.querySelectorAll('[data-vivo="aro"]')) el.setAttribute('stroke-dashoffset', (Number(el.dataset.c) * (1 - queda)).toFixed(3));
  for (const el of isla.querySelectorAll('[data-vivo="hora"]')) el.textContent = textoReloj();
  const p = progreso(v.desde, v.cuenta_hasta);
  for (const el of isla.querySelectorAll('[data-vivo="barra"]')) if (p !== null) el.style.width = `${(p * 100).toFixed(1)}%`;
  if (accion === 'llegada' && qrLlegada) {
    qrLlegada.cambia_en -= 1;
    if (qrLlegada.cambia_en <= 0) refrescarLlegada();
    for (const el of isla.querySelectorAll('[data-vivo="qr-llegada"]')) el.style.width = `${(Math.max(0, qrLlegada.cambia_en) / 30) * 100}%`;
  }
}, 1000);

async function refrescarLlegada() {
  qrLlegada = await invocar('qr_llegada');
  if (!qrLlegada) aviso = 'No se pudo generar el código. Pide al personal que registre tu llegada.';
  else aviso = null;
  dibujar();
}

// ------------------------------------------------------------------ clics y arrastre
let presion = null;

isla.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || ui === 'abierta') return;
  presion = { x: e.screenX, id: e.pointerId, movido: false };
  isla.setPointerCapture(e.pointerId);
});

isla.addEventListener('pointermove', (e) => {
  if (!presion || e.pointerId !== presion.id) return;
  const dx = e.screenX - presion.x;
  if (!presion.movido && Math.abs(dx) > 6) {
    presion.movido = true;
    arrastrando = true;
    isla.classList.add('arrastrando');
    invocar('isla_arrastre', { fase: 'inicio', dx: 0 });
  }
  if (presion.movido) {
    cancelAnimationFrame(presion.raf);
    presion.raf = requestAnimationFrame(() => invocar('isla_arrastre', { fase: 'mover', dx }));
  }
});

function soltar(e) {
  if (!presion || e.pointerId !== presion.id) return;
  const fueArrastre = presion.movido;
  cancelAnimationFrame(presion.raf);
  presion = null;
  if (fueArrastre) {
    arrastrando = false;
    isla.classList.remove('arrastrando');
    invocar('isla_arrastre', { fase: 'fin', dx: 0 });
    programar();
  } else {
    cambiar('abierta');
  }
}
isla.addEventListener('pointerup', soltar);
isla.addEventListener('pointercancel', soltar);

isla.addEventListener('click', async (e) => {
  if (ui !== 'abierta') return;
  const b = e.target.closest('button');
  if (!b) return;
  const codigo = vista().equipo ?? '';
  const d = b.dataset;
  if (d.cerrar !== undefined) { cambiar(urgente() ? 'compacta' : 'mini'); return; }
  if (d.entendido) {
    await invocar('confirmar_anuncio', { id: Number(d.entendido) });
    fijaHasta = 0;
    cambiar('compacta');
    return;
  }
  const otroConfirmar = confirmar;
  confirmar = '';
  if (d.volver !== undefined) { accion = null; aviso = ''; resultado = null; }
  else if (d.accion) {
    accion = d.accion; aviso = '';
    if (accion === 'llegada') { await refrescarLlegada(); programar(); return; }
    if (accion === 'salir') invocar('isla_foco');
    if (ACCIONES[accion]?.qr) {
      const r = ruta(accion, codigo);
      if (!(r in qrCache)) qrCache[r] = await invocar('qr', { ruta: r });
    }
  } else if (d.vuelvo !== undefined) {
    salir.vuelvo = Number(d.vuelvo);
  } else if (d.hacer) {
    // Extender, liberar, reportar, pedir ayuda o salir un rato: lo resuelve el servidor y se muestra el resultado.
    haciendo = true;
    dibujar();
    try {
      const texto = await invocar('accion_isla', {
        accion: d.hacer,
        categoria: d.categoria ?? null,
        minutos: d.minutos ? Number(d.minutos) : null,
        mensaje: d.hacer === 'salir' && salir.proceso ? salir.mensaje : null,
        vuelvoMin: d.hacer === 'salir' && salir.vuelvo ? salir.vuelvo : null,
      });
      resultado = { ok: true, texto };
    } catch (err) {
      resultado = { ok: false, texto: String(err) };
    }
    haciendo = false;
    accion = 'hecho';
    fijaHasta = Date.now() + 8000;
  } else if (d.personal !== undefined) {
    accion = 'personal'; aviso = '';
    invocar('isla_foco');
  } else if (d.desbloquear !== undefined || d.retirar !== undefined) {
    const clave = isla.querySelector('input[data-clave]')?.value ?? '';
    if (!clave) { aviso = 'Escribe la clave de emergencia.'; }
    else if (d.retirar !== undefined && otroConfirmar !== 'retirar') { confirmar = 'retirar'; aviso = ''; }
    else {
      b.disabled = true;
      try {
        if (d.retirar !== undefined) { await invocar('retirar', { claveIngresada: clave }); return; }
        await invocar('emergencia', { claveIngresada: clave });
        cambiar('compacta');
        return;
      } catch (err) { aviso = String(err); }
    }
  } else if (d.limpiar !== undefined) {
    if (otroConfirmar !== 'limpiar') { confirmar = 'limpiar'; aviso = ''; }
    else {
      b.disabled = true;
      try {
        const n = await invocar('limpiar_sesion');
        limpiezaDescartada = vista().limpieza_desde ?? '';
        aviso = '';
        mostrarBreve(n === 1 ? 'Se borró 1 archivo.' : `Se borraron ${n} archivos.`);
      } catch (err) { aviso = String(err); }
    }
  } else if (d.noLimpiar !== undefined) {
    limpiezaDescartada = vista().limpieza_desde ?? '';
    aviso = '';
  }
  programar();
  dibujar();
});

// Confirmación corta que reemplaza el detalle un momento.
function mostrarBreve(texto) {
  const v = paquete?.vista;
  if (!v) return;
  const antes = v.detalle;
  v.detalle = texto;
  dibujar();
  setTimeout(() => { if (paquete?.vista === v) { v.detalle = antes; dibujar(); } }, 4000);
}

// Lo que se escribe en los paneles se guarda en el estado (sobrevive a que se redibuje la isla).
isla.addEventListener('input', (e) => {
  if (e.target.matches('[data-campo="salir-mensaje"]')) salir.mensaje = e.target.value;
});
isla.addEventListener('change', (e) => {
  if (e.target.matches('[data-salir-proceso]')) {
    salir.proceso = e.target.checked;
    dibujar();
    if (salir.proceso) isla.querySelector('[data-campo="salir-mensaje"]')?.focus();
  }
});

// Al escribir la clave, Enter desbloquea.
isla.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('input[data-clave]')) isla.querySelector('[data-desbloquear]')?.click();
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui === 'abierta') cambiar(urgente() ? 'compacta' : 'mini'); });

// Respaldo si la ventana no recibe el aviso de isla.rs (p. ej. al probar en un navegador).
isla.addEventListener('pointerenter', () => alDentro(true));
isla.addEventListener('pointerleave', () => { if (!presion) alDentro(false); });

// ------------------------------------------------------------------ arranque
escuchar('faro://vista', alRecibir);
escuchar('faro://dentro', alDentro);
escuchar('faro://pantalla-completa', (c) => { completa = !!c; dibujar(); });
invocar('estado_inicial').then(alRecibir);
// Al arrancar se muestra compacta un momento y luego se encoge.
setTimeout(programar, 1500);
