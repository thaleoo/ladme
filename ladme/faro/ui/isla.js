import { invocar, escuchar, fijarDesfase, cuenta, progreso, textoHora, textoReloj, esc, ICONOS } from './comun.js';

// ------------------------------------------------------------------ estado
const isla = document.getElementById('isla');
const capas = Object.fromEntries([...isla.querySelectorAll('.capa')].map((c) => [c.dataset.capa, c]));

let paquete = null;
let ui = 'compacta';          // 'mini' | 'compacta' | 'abierta'
let accion = null;            // panel de QR: 'reservar' | 'extender' | 'liberar' | 'reportar'
let aviso = '';               // error al abrir el navegador
let enlaceVisible = '';       // dirección para copiar si no se pudo abrir
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

const ACCIONES = {
  reservar: { texto: 'Reservar este equipo', titulo: 'Reserva desde tu celular', cuerpo: 'Escanea, elige hasta qué hora y el equipo queda a tu nombre.', icono: ICONOS.mas, principal: true },
  extender: { texto: 'Extender', titulo: 'Extiende tu reserva', cuerpo: 'Escanea y elige cuánto tiempo más necesitas. Un toque y listo.', icono: ICONOS.reloj, principal: true },
  liberar:  { texto: 'Liberar', titulo: 'Libera el equipo', cuerpo: 'Si ya terminaste, escanea y confirma: el equipo queda libre para otra persona.', icono: ICONOS.salir },
  reportar: { texto: 'Reportar falla', titulo: 'Reporta una falla', cuerpo: 'Cuéntale al laboratorio qué pasa con este equipo.', icono: ICONOS.falla },
};
const ruta = (a, codigo) => `/pc/${encodeURIComponent(codigo)}/${a}`;

const vista = () => paquete?.vista ?? { estado: 'conectando', titulo: 'Conectando con LADME', detalle: '', en_linea: false };
const urgente = (v = vista()) => !!v.insistir || ['por_terminar', 'gracia', 'libre_en_uso'].includes(v.estado);

function accionesDe(estado) {
  if (estado === 'reservado' || estado === 'por_terminar') return ['extender', 'liberar', 'reportar'];
  if (estado === 'libre' || estado === 'libre_en_uso' || estado === 'gracia') return ['reservar', 'reportar'];
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
      <span class="etiqueta">${etiqueta(v)}</span>
      ${v.en_linea ? '' : '<span class="sin-red">sin red</span>'}
      <span class="valor num" data-vivo="valor">${valorCorto(v)}</span>
    </div>`;
}

function htmlAbierta(v) {
  const codigo = v.equipo ?? '';
  const p = progreso(v.desde, v.cuenta_hasta);
  let cuerpo;
  if (accion) {
    const a = ACCIONES[accion];
    const r = ruta(accion, codigo);
    cuerpo = `<div class="panel-qr">
        <div class="qr">${qrCache[r] ?? ''}</div>
        <div>
          <p><strong>${a.titulo}</strong>${a.cuerpo}</p>
          ${aviso ? `<p class="aviso-error">${esc(aviso)}</p>` : ''}
          <div class="acciones" style="margin-top:0">
            ${enlaceVisible
              ? `<button class="boton" data-copiar>${ICONOS.enlace} Copiar enlace</button>`
              : `<button class="boton" data-abrir="${esc(r)}">${ICONOS.enlace} Abrir aquí</button>`}
            <button class="boton" data-volver title="Volver">${ICONOS.volver}</button>
          </div>
        </div>
      </div>`;
  } else {
    cuerpo = `
      <h2 class="titulo">${esc(v.titulo)}</h2>
      ${v.detalle ? `<p class="detalle">${esc(v.detalle)}</p>` : ''}
      ${v.mensaje ? `<div class="mensaje">«${esc(v.mensaje)}»</div>` : ''}
      ${v.cuenta_hasta ? `<div class="reloj"><span class="grande num" data-vivo="grande">${cuenta(v.cuenta_hasta)}</span>
          <span class="que">${queCuenta(v)}<br>${textoHora(v.cuenta_hasta)}</span></div>` : ''}
      ${p !== null ? `<div class="barra"><i data-vivo="barra" style="width:${(p * 100).toFixed(1)}%"></i></div>` : ''}
      <div class="acciones">${accionesDe(v.estado).map((k) => {
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
      ${cuerpo}
      <div class="pie"><span>Faro · LADME ${esc(paquete?.version ?? '')}</span><span class="num" data-vivo="hora">${textoReloj()}</span></div>
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
    if (nuevo[k] !== html[k]) { capas[k].innerHTML = nuevo[k]; html[k] = nuevo[k]; }
    capas[k].classList.toggle('activa', k === ui);
  }

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
  if (nuevo !== 'abierta') { accion = null; aviso = ''; enlaceVisible = ''; }
  ui = nuevo;
  dibujar();
}

// Temporizadores: encogerse sola, cerrarse sola, crecer al pasar el mouse.
function programar() {
  clearTimeout(timers.reposo);
  if (arrastrando || dentro) return;
  if (ui === 'abierta') {
    timers.reposo = setTimeout(() => cambiar(urgente() ? 'compacta' : 'mini'), PAUSA_CERRAR);
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
  if (v.insistir && (!insistiaAntes || Date.now() - ultimaInsistencia > 5 * 60_000)) {
    ultimaInsistencia = Date.now();
    accion = null;
    ui = 'abierta';
  } else if (estadoAntes !== null && estadoAntes !== v.estado && ui === 'mini') {
    ui = 'compacta'; // anuncia el cambio y vuelve a encogerse después
    clearTimeout(timers.reposo);
    setTimeout(programar, AVISO_CAMBIO - PAUSA_MINI);
  }
  if (estadoAntes !== v.estado) accion = null;
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
}, 1000);

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
  if (b.dataset.cerrar !== undefined) { cambiar(urgente() ? 'compacta' : 'mini'); return; }
  if (b.dataset.volver !== undefined) { accion = null; aviso = ''; enlaceVisible = ''; }
  else if (b.dataset.accion) {
    accion = b.dataset.accion; aviso = ''; enlaceVisible = '';
    const r = ruta(accion, codigo);
    if (!(r in qrCache)) qrCache[r] = await invocar('qr', { ruta: r });
  } else if (b.dataset.abrir) {
    b.disabled = true;
    try {
      await invocar('abrir', { ruta: b.dataset.abrir });
      cambiar(urgente() ? 'compacta' : 'mini');
      return;
    } catch (err) {
      aviso = String(err);
      enlaceVisible = (await invocar('enlace', { ruta: b.dataset.abrir })) ?? '';
    }
  } else if (b.dataset.copiar !== undefined) {
    copiar(enlaceVisible);
    aviso = 'Enlace copiado. Pégalo en el navegador.';
  }
  dibujar();
});

function copiar(texto) {
  const campo = document.createElement('textarea');
  campo.value = texto;
  campo.style.position = 'fixed';
  campo.style.opacity = '0';
  document.body.appendChild(campo);
  campo.select();
  try { document.execCommand('copy'); } catch { /* sin portapapeles */ }
  campo.remove();
}

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
