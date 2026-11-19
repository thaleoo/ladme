import { invocar, escuchar, fijarDesfase, cuenta, progreso, textoHora, textoReloj, esc, ICONOS } from './comun.js';

// ------------------------------------------------------------------ estado
const isla = document.getElementById('isla');
const capas = Object.fromEntries([...isla.querySelectorAll('.capa')].map((c) => [c.dataset.capa, c]));

let paquete = null;
let ui = 'compacta';          // 'mini' | 'compacta' | 'abierta'
let accion = null;            // panel: 'reservar' | 'extender' | 'liberar' | 'reportar' | 'llegada' | 'personal'
let aviso = '';               // mensaje bajo el panel (error o confirmación)
let confirmar = '';           // botón que pide un segundo clic ('retirar' | 'limpiar')
let qrLlegada = null;         // { svg, cambia_en } del QR de llegada (cambia cada 30 s)
let anuncioVisto = '';
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

const ACCIONES = {
  reservar: { texto: 'Reservar este equipo', titulo: 'Reserva desde tu celular', cuerpo: 'Escanea, elige hasta qué hora y el equipo queda a tu nombre.', icono: ICONOS.mas, principal: true },
  extender: { texto: 'Extender', titulo: 'Extiende tu reserva', cuerpo: 'Escanea y elige cuánto tiempo más necesitas. Un toque y listo.', icono: ICONOS.reloj, principal: true },
  liberar:  { texto: 'Liberar', titulo: 'Libera el equipo', cuerpo: 'Si ya terminaste, escanea y confirma: el equipo queda libre para otra persona.', icono: ICONOS.salir },
  reportar: { texto: 'Reportar falla', titulo: 'Reporta una falla', cuerpo: 'Cuéntale al laboratorio qué pasa con este equipo.', icono: ICONOS.falla },
  llegada:  { texto: 'Registrar llegada', titulo: 'Registra tu llegada', cuerpo: 'Escanéalo con tu celular, con tu sesión de LADME abierta. Solo funciona para quien hizo la reserva y el código cambia cada 30 s.', icono: ICONOS.check, principal: true },
};
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
  if (estado === 'reservado' || estado === 'por_terminar') return [...(v.llegada_pendiente ? ['llegada'] : []), 'extender', 'liberar', 'reportar'];
  if (estado === 'libre' || estado === 'libre_en_uso' || estado === 'gracia' || estado === 'compartido') return ['reservar', 'reportar'];
  return ['reportar'];
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
function htmlMini(v) {
  return `<div class="mini"><span class="punto"></span><span class="valor num" data-vivo="valor">${valorCorto(v)}</span></div>`;
}

function htmlCompacta(v) {
  return `<div class="compacta">
      <span class="punto"></span>
      <span class="codigo">${esc(v.equipo ?? 'Faro')}</span>
      <span class="sep"></span>
      <span class="etiqueta">${v.anuncio ? `<span class="megafono">${ICONOS.megafono}</span>` : ''}${v.llegada_pendiente ? 'Registra tu llegada' : etiqueta(v)}</span>
      ${v.en_linea ? '' : '<span class="sin-red">sin red</span>'}
      <span class="valor num" data-vivo="valor">${valorCorto(v)}</span>
    </div>`;
}

function htmlAbierta(v) {
  const codigo = v.equipo ?? '';
  const p = progreso(v.desde, v.cuenta_hasta);
  let cuerpo;
  if (accion === 'personal') {
    cuerpo = `<div class="panel-personal">
        <p><strong>Personal del laboratorio</strong>Con la clave de emergencia puedes desbloquear este equipo 2 horas o quitar Faro de este PC.</p>
        <input class="campo" data-clave type="password" autocomplete="off" placeholder="Clave de emergencia" aria-label="Clave de emergencia" />
        ${aviso ? `<p class="aviso-error">${esc(aviso)}</p>` : ''}
        <div class="acciones">
          <button class="boton principal" data-desbloquear>${ICONOS.candado} Desbloquear 2 h</button>
          <button class="boton ${confirmar === 'retirar' ? 'peligro' : ''}" data-retirar>${ICONOS.papelera} ${confirmar === 'retirar' ? '¿Seguro? Quitar Faro' : 'Quitar Faro de este PC'}</button>
          <button class="boton" data-volver title="Volver">${ICONOS.volver}</button>
        </div>
      </div>`;
  } else if (accion) {
    const a = ACCIONES[accion];
    const r = ruta(accion, codigo);
    const svg = accion === 'llegada' ? qrLlegada?.svg : qrCache[r];
    const corto = accion === 'llegada' ? '' : enlaceCorto(codigo);
    cuerpo = `<div class="panel-qr">
        <div class="qr">${svg ?? ''}</div>
        <div>
          <p><strong>${a.titulo}</strong>${a.cuerpo}</p>
          ${corto ? `<p class="corto">¿Sin cámara? Entra a <span class="num">${esc(corto)}</span></p>` : ''}
          ${accion === 'llegada' ? `<div class="barra fina"><i data-vivo="qr-llegada"></i></div>` : ''}
          ${aviso ? `<p class="aviso-error">${esc(aviso)}</p>` : ''}
          <div class="acciones" style="margin-top:0">
            <button class="boton" data-volver title="Volver">${ICONOS.volver} Volver</button>
          </div>
        </div>
      </div>`;
  } else {
    cuerpo = `
      <h2 class="titulo">${esc(v.titulo)}</h2>
      ${v.detalle ? `<p class="detalle">${esc(v.detalle)}</p>` : ''}
      ${v.mensaje ? `<div class="mensaje">«${esc(v.mensaje)}»</div>` : ''}
      ${v.limpieza_desde && limpiezaDescartada !== v.limpieza_desde ? `<div class="limpieza">
          <p><strong>¿Borrar tus archivos?</strong>Se borrarán los archivos que se guardaron en Descargas y Escritorio durante la reserva, para que el siguiente no los vea.</p>
          ${aviso ? `<p class="aviso-error">${esc(aviso)}</p>` : ''}
          <div class="acciones">
            <button class="boton ${confirmar === 'limpiar' ? 'peligro' : 'principal'}" data-limpiar>${ICONOS.papelera} ${confirmar === 'limpiar' ? '¿Seguro? No se puede deshacer' : 'Borrar mis archivos'}</button>
            <button class="boton" data-no-limpiar>No, gracias</button>
          </div>
        </div>` : ''}
      ${v.cuenta_hasta ? `<div class="reloj"><span class="grande num" data-vivo="grande">${cuenta(v.cuenta_hasta)}</span>
          <span class="que">${queCuenta(v)}<br>${textoHora(v.cuenta_hasta)}</span></div>` : ''}
      ${p !== null ? `<div class="barra"><i data-vivo="barra" style="width:${(p * 100).toFixed(1)}%"></i></div>` : ''}
      <div class="acciones">${accionesDe(v.estado, v).map((k) => {
        const a = ACCIONES[k];
        return `<button class="boton ${a.principal ? 'principal' : ''}" data-accion="${k}">${a.icono} ${a.texto}</button>`;
      }).join('')}</div>`;
  }
  return `<div class="abierta">
      <div class="cabeza">
        <span class="punto"></span>
        <span class="codigo">${esc(codigo)}</span>
        ${v.sistema ? `<span class="sistema">${esc(v.sistema)}</span>` : ''}
        ${v.en_linea ? '' : '<span class="sin-red">sin red</span>'}
        <button class="cerrar" data-cerrar title="Cerrar">${ICONOS.cerrar}</button>
      </div>
      ${v.anuncio ? `<div class="anuncio">${ICONOS.megafono}<span>${esc(v.anuncio)}</span></div>` : ''}
      ${v.compartido ? `<div class="protegido">${ICONOS.candado}<span><strong>Uso compartido${v.compartido.titular ? ` de ${esc(v.compartido.titular)}` : ''}.</strong>
        ${v.compartido.protegidos?.length ? `No cierres ${esc(v.compartido.protegidos.join(', '))}.` : 'No cierres los programas abiertos.'}
        No reinicies, apagues ni cierres la sesión.${v.compartido.nota ? ` «${esc(v.compartido.nota)}»` : ''}</span></div>` : ''}
      ${v.espera > 0 && (v.estado === 'por_terminar' || v.estado === 'reservado') ? `<div class="espera">${ICONOS.reloj}<span>${v.espera === 1 ? 'Hay 1 persona esperando' : `Hay ${v.espera} personas esperando`} un equipo. Si ya terminaste, libéralo desde el QR.</span></div>` : ''}
      ${cuerpo}
      <div class="pie"><span>Faro · LADME ${esc(paquete?.version ?? '')}${paquete?.clave_disponible && accion !== 'personal'
        ? ` · <button class="link-pie" data-personal title="Personal del laboratorio">${ICONOS.llave} Personal</button>` : ''}</span><span class="num" data-vivo="hora">--</span></div>
    </div>`;
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
  isla.style.setProperty('--w', `${w}px`);
  isla.style.setProperty('--h', `${h}px`);
  isla.style.setProperty('--r', ui === 'abierta' ? '28px' : `${Math.round(h / 2)}px`);

  // Solo la isla recibe clics: se informa su rectángulo (con un margen pequeño) a la ventana.
  const m = 4;
  if (oculta()) invocar('isla_zona', { x: 0, y: 0, ancho: 0, alto: 0 });
  else invocar('isla_zona', { x: (window.innerWidth - w) / 2 - m, y: 0, ancho: w + 2 * m, alto: h + m });
  programar();
}

function cambiar(nuevo) {
  clearTimeout(timers.crecer);
  if (nuevo === ui) return;
  if (nuevo !== 'abierta') { accion = null; aviso = ''; confirmar = ''; fijaHasta = 0; }
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
  if (v.insistir && (!insistiaAntes || Date.now() - ultimaInsistencia > 5 * 60_000)) {
    ultimaInsistencia = Date.now();
    accion = null;
    ui = 'abierta';
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
  if (estadoAntes !== v.estado && accion !== 'personal') accion = null;
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
  const otroConfirmar = confirmar;
  confirmar = '';
  if (d.volver !== undefined) { accion = null; aviso = ''; }
  else if (d.accion) {
    accion = d.accion; aviso = '';
    if (accion === 'llegada') { await refrescarLlegada(); programar(); return; }
    const r = ruta(accion, codigo);
    if (!(r in qrCache)) qrCache[r] = await invocar('qr', { ruta: r });
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
