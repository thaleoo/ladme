import { invocar, escuchar, fijarDesfase, cuenta, cuando, conPunto, textoReloj, textoFecha, esc, ICONOS } from './comun.js';

const principal = new URLSearchParams(location.search).has('principal');
const main = document.getElementById('principal');
const pie = document.getElementById('pie');
let paquete = null;
let pidiendoClave = false;

const ETIQUETA = {
  bloqueado: 'Sin reserva vigente',
  mantenimiento: 'Fuera de servicio',
  ocupado: 'Actividad del laboratorio',
  reservado: 'Proceso desatendido',
  por_terminar: 'Proceso desatendido',
};

const horaHtml = () => textoReloj().replace(/\s*([ap]\.\s?m\.)$/i, '<small>$1</small>');
function reloj() {
  return `<div class="hora num" data-vivo="hora">${horaHtml()}</div><div class="fecha" data-vivo="fecha">${textoFecha()}</div>`;
}

function pintar() {
  const v = paquete?.vista;
  if (!v) return;
  document.body.dataset.estado = v.estado;
  const desatendido = v.pantalla === 'desatendido';
  if (!principal) {
    document.body.classList.add('secundario');
    main.innerHTML = `<div class="centro solo">${reloj()}<div class="estado"><span class="punto"></span>${esc(v.equipo)} · ${desatendido ? 'en uso' : 'bloqueado'}</div></div>`;
    pie.innerHTML = '';
    return;
  }
  const conQr = paquete.qr && (v.estado === 'bloqueado' || desatendido);
  let texto;
  if (desatendido) {
    texto = `<div class="estado"><span class="punto"></span>${esc(v.equipo)} · Proceso desatendido</div>
      <h1 class="titulo">No apagues ni cierres la sesión</h1>
      <p class="detalle">${v.titular ? `${esc(v.titular)} dejó` : 'Hay'} ${conPunto(`un proceso ejecutándose en este equipo${v.cuenta_hasta ? ` hasta ${cuando(v.cuenta_hasta)}` : ''}`)} Mueve el mouse para volver al escritorio.</p>
      ${v.mensaje ? `<div class="mensaje">«${esc(v.mensaje)}»</div>` : ''}`;
  } else if (v.estado === 'mantenimiento') {
    texto = `<div class="icono-grande">${ICONOS.llaveInglesa}</div>
      <div class="estado"><span class="punto"></span>${esc(v.equipo)} · ${esc(v.titulo)}</div>
      <h1 class="titulo">Este equipo no está disponible</h1>
      <p class="detalle">${esc(v.detalle)} Busca otro equipo libre en LADME.</p>`;
  } else if (v.estado === 'ocupado') {
    texto = `<div class="estado"><span class="punto"></span>${esc(v.equipo)} · Bloqueado por el laboratorio</div>
      <h1 class="titulo">${esc(v.detalle)}</h1>
      <p class="detalle">${v.cuenta_hasta ? `Termina ${cuando(v.cuenta_hasta)} · faltan <span class="num" data-vivo="cuenta">${cuenta(v.cuenta_hasta)}</span>.` : ''}</p>`;
  } else {
    texto = `<div class="estado"><span class="punto"></span>${esc(ETIQUETA[v.estado] ?? v.titulo)}</div>
      <h1 class="titulo">${esc(v.titulo)}</h1>
      <p class="detalle">${esc(v.detalle)}</p>
      ${v.siguiente ? `<p class="detalle" style="margin-top:10px">Hay una reserva desde ${cuando(v.siguiente)}: puedes reservar hasta esa hora.</p>` : ''}`;
  }
  main.innerHTML = `<div class="centro ${conQr ? '' : 'solo'}">
      <div>${reloj()}${texto}${v.anuncio ? `<div class="anuncio">${ICONOS.megafono}<span>${esc(v.anuncio)}</span></div>` : ''}</div>
      ${conQr ? `<div class="tarjeta">
          <div class="qr">${paquete.qr}</div>
          <div class="que">${desatendido ? '¿Necesitas este equipo? Escríbele al titular' : 'Escanea para reservar'}</div>
          <div class="url">${esc((paquete.url_qr ?? '').replace(/^https?:\/\//, ''))}</div>
          ${desatendido ? '' : '<div class="espera">Se desbloquea solo al detectar tu reserva</div>'}
        </div>` : ''}
    </div>`;
  pintarPie(v);
}

function pintarPie(v) {
  const izquierda = pidiendoClave
    ? `<form class="personal" id="form-clave">
        <input class="campo" id="clave" placeholder="XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false" maxlength="16" />
        <button class="boton principal" type="submit">Desbloquear</button>
        <button class="boton" type="button" data-cancelar>Cancelar</button>
        <span class="error" id="error"></span>
      </form>`
    : paquete.clave_disponible && v.pantalla !== 'desatendido'
      ? `<button class="enlace" data-personal>${ICONOS.llave} Personal del laboratorio</button>`
      : '<span></span>';
  pie.innerHTML = `${izquierda}<span>Faro ${esc(paquete.version)}${v.en_linea ? '' : ' · sin conexión'}</span>`;
  if (pidiendoClave) document.getElementById('clave')?.focus();
}

pie.addEventListener('click', (e) => {
  if (e.target.closest('[data-personal]')) { pidiendoClave = true; pintarPie(paquete.vista); }
  if (e.target.closest('[data-cancelar]')) { pidiendoClave = false; pintarPie(paquete.vista); }
});
pie.addEventListener('submit', async (e) => {
  e.preventDefault();
  const campo = document.getElementById('clave');
  try {
    await invocar('emergencia', { claveIngresada: campo.value });
    pidiendoClave = false;
  } catch (err) {
    document.getElementById('error').textContent = String(err);
    campo.select();
  }
});

setInterval(() => {
  const q = (k) => main.querySelector(`[data-vivo="${k}"]`);
  if (q('hora')) q('hora').innerHTML = horaHtml();
  if (q('fecha')) q('fecha').textContent = textoFecha();
  const v = paquete?.vista;
  if (q('cuenta') && v?.cuenta_hasta) q('cuenta').textContent = cuenta(v.cuenta_hasta);
}, 1000);

// Atajos que suelen cerrar ventanas o recargar la página no hacen nada aquí.
document.addEventListener('keydown', (e) => {
  if ((e.altKey && e.key === 'F4') || e.key === 'F5' || (e.ctrlKey && ['r', 'w', 'R', 'W'].includes(e.key))) e.preventDefault();
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

function alRecibir(p) {
  const cambio = JSON.stringify(p.vista) !== JSON.stringify(paquete?.vista) || p.qr !== paquete?.qr;
  paquete = p;
  fijarDesfase(p.desfase_ms);
  if (cambio && !pidiendoClave) pintar();
}
escuchar('faro://vista', alRecibir);
invocar('estado_inicial').then(alRecibir);
