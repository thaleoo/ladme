import { invocar, escuchar, fijarDesfase, cuenta, progreso, textoHora, textoReloj, esc, ICONOS } from './comun.js';

const isla = document.getElementById('isla');
const contenido = document.getElementById('contenido');
const medida = document.querySelector('#medida .isla__contenido');

let paquete = null;
let abierta = false;
let accion = null; // 'reservar' | 'extender' | 'liberar' | 'reportar'
let aviso = ''; // error al abrir el navegador
let insistiaAntes = false;
let ultimaInsistencia = 0;
const qrCache = {};

const ACCIONES = {
  reservar: { texto: 'Reservar este equipo', titulo: 'Reserva desde tu celular', cuerpo: 'Escanea, elige hasta qué hora y el equipo queda a tu nombre.', ruta: (c) => `/pc/${c}/reservar`, icono: ICONOS.mas, principal: true },
  extender: { texto: 'Extender', titulo: 'Extiende tu reserva', cuerpo: 'Escanea y elige cuánto tiempo más necesitas. Un toque y listo.', ruta: (c) => `/pc/${c}/extender`, icono: ICONOS.reloj, principal: true },
  liberar:  { texto: 'Liberar', titulo: 'Libera el equipo', cuerpo: 'Si ya terminaste, escanea y confirma: el equipo queda libre para otra persona.', ruta: (c) => `/pc/${c}/liberar`, icono: ICONOS.salir },
  reportar: { texto: 'Reportar falla', titulo: 'Reporta una falla', cuerpo: 'Cuéntale al laboratorio qué pasa con este equipo.', ruta: (c) => `/pc/${c}/reportar`, icono: ICONOS.falla },
};

function accionesDe(estado) {
  if (estado === 'reservado' || estado === 'por_terminar') return ['extender', 'liberar', 'reportar'];
  if (estado === 'libre' || estado === 'libre_en_uso' || estado === 'gracia') return ['reservar', 'reportar'];
  return ['reportar'];
}

function etiquetaCompacta(v) {
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
    case 'gracia': return paquete?.vista?.modo === 'bloquear' ? 'para el bloqueo' : 'de gracia';
    case 'desbloqueado': return 'de uso libre';
    case 'ocupado': return 'hasta que termine';
    case 'libre': case 'libre_en_uso': return 'para la próxima reserva';
    default: return '';
  }
}

function htmlCompacta(v) {
  const valor = v.cuenta_hasta && v.estado !== 'libre' ? cuenta(v.cuenta_hasta) : textoReloj();
  return `<div class="compacta">
      <span class="punto"></span>
      <span class="codigo">${esc(v.equipo ?? 'Faro')}</span>
      <span class="sep"></span>
      <span class="etiqueta">${etiquetaCompacta(v)}</span>
      ${v.en_linea ? '' : '<span class="sin-red">sin red</span>'}
      <span class="valor num" data-vivo="valor">${valor}</span>
    </div>`;
}

function htmlAbierta(v) {
  const codigo = v.equipo ?? '';
  const p = progreso(v.desde, v.cuenta_hasta);
  let cuerpo;
  if (accion) {
    const a = ACCIONES[accion];
    const ruta = a.ruta(codigo);
    const svg = qrCache[ruta];
    cuerpo = `<div class="panel-qr">
        <div class="qr">${svg ?? ''}</div>
        <div>
          <p><strong>${a.titulo}</strong>${a.cuerpo}</p>
          ${aviso ? `<p class="aviso-error">${esc(aviso)}</p>` : ''}
          <div class="acciones" style="margin-top:0">
            <button class="boton" data-abrir="${esc(ruta)}">${ICONOS.enlace} Abrir aquí</button>
            <button class="boton" data-volver>${ICONOS.volver}</button>
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
  return `<div class="abierta-c">
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

const vacia = { estado: 'conectando', titulo: 'Conectando con LADME', detalle: '', en_linea: false };

async function pintar() {
  const v = paquete?.vista ?? vacia;
  const urgente = ['por_terminar', 'gracia', 'libre_en_uso'].includes(v.estado);
  isla.dataset.estado = v.estado;
  isla.classList.toggle('pulso', urgente || v.estado === 'reservado');
  isla.classList.toggle('urgente', urgente);
  isla.classList.toggle('abierta', abierta);

  if (abierta && accion) {
    const ruta = ACCIONES[accion].ruta(v.equipo ?? '');
    if (!(ruta in qrCache)) qrCache[ruta] = await invocar('qr', { ruta });
  }
  const html = abierta ? htmlAbierta(v) : htmlCompacta(v);
  medida.innerHTML = html;
  const w = Math.ceil(medida.scrollWidth) + 2;
  const h = Math.ceil(medida.scrollHeight) + 2;
  const actual = isla.getBoundingClientRect();
  // Primero se agranda la ventana (si hace falta), luego se anima la isla, y al final se ajusta.
  await invocar('isla_tamano', { ancho: Math.max(w, actual.width) + 24, alto: Math.max(h, actual.height) + 24 });
  contenido.innerHTML = html;
  isla.style.width = `${w}px`;
  isla.style.height = `${h}px`;
  clearTimeout(pintar.t);
  pintar.t = setTimeout(() => invocar('isla_tamano', { ancho: w + 24, alto: h + 24 }), 460);
}

function alRecibir(p) {
  const antes = paquete?.vista;
  paquete = p;
  fijarDesfase(p.desfase_ms);
  const v = p.vista;
  // Se abre sola cuando algo pide atención (y de nuevo cada 5 minutos si sigue igual).
  if (v?.insistir && (!insistiaAntes || Date.now() - ultimaInsistencia > 5 * 60_000)) {
    abierta = true;
    accion = null;
    ultimaInsistencia = Date.now();
  }
  insistiaAntes = !!v?.insistir;
  if (antes?.estado !== v?.estado) accion = null;
  pintar();
}

// Lo que cambia cada segundo se actualiza sin volver a dibujar.
setInterval(() => {
  const v = paquete?.vista;
  if (!v) return;
  const q = (k) => contenido.querySelector(`[data-vivo="${k}"]`);
  if (q('valor')) q('valor').textContent = v.cuenta_hasta && v.estado !== 'libre' ? cuenta(v.cuenta_hasta) : textoReloj();
  if (q('grande') && v.cuenta_hasta) q('grande').textContent = cuenta(v.cuenta_hasta);
  if (q('hora')) q('hora').textContent = textoReloj();
  const p = progreso(v.desde, v.cuenta_hasta);
  if (q('barra') && p !== null) q('barra').style.width = `${(p * 100).toFixed(1)}%`;
}, 1000);

isla.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!abierta) { abierta = true; pintar(); return; }
  if (!b) return;
  if (b.dataset.cerrar !== undefined) { abierta = false; accion = null; aviso = ''; }
  else if (b.dataset.volver !== undefined) { accion = null; aviso = ''; }
  else if (b.dataset.accion) { accion = b.dataset.accion; aviso = ''; }
  else if (b.dataset.abrir) {
    aviso = '';
    invocar('abrir', { ruta: b.dataset.abrir })
      .then(() => { abierta = false; accion = null; pintar(); })
      .catch((err) => { aviso = String(err); pintar(); });
    return;
  }
  pintar();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && abierta) { abierta = false; accion = null; pintar(); } });

escuchar('faro://vista', alRecibir);
invocar('estado_inicial').then(alRecibir);
