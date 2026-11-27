import { invocar, escuchar, fijarDesfase, cuenta, cuando, conPunto, textoReloj, textoFecha, esc, ICONOS, DIBUJO_NFC } from './comun.js';

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

// «ladme.pages.dev/e/UNAL-07»: cabe entero y abre la ficha del equipo (con «Reservar»).
function enlaceCorto(codigo) {
  const base = (paquete?.url_base ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  return base && codigo ? `${esc(base)}/e/<b>${esc(codigo)}</b>` : esc((paquete?.url_qr ?? '').replace(/^https?:\/\//, ''));
}

const horaHtml = () => textoReloj().replace(/\s*([ap]\.\s?m\.)$/i, '<small>$1</small>');
function reloj() {
  return `<div class="hora num" data-vivo="hora">${horaHtml()}</div><div class="fecha" data-vivo="fecha">${textoFecha()}</div>`;
}

function pintar() {
  const v = paquete?.vista;
  if (!v) return;
  document.body.dataset.estado = v.estado;
  const desatendido = v.pantalla === 'desatendido';
  const suspendido = v.pantalla === 'suspension';
  if (!principal) {
    document.body.classList.add('secundario');
    main.innerHTML = `<div class="centro solo">${reloj()}<div class="estado"><span class="punto"></span>${esc(v.equipo)} · ${desatendido ? 'en uso' : suspendido ? 'suspendido' : 'bloqueado'}</div></div>`;
    pie.innerHTML = '';
    return;
  }
  if (suspendido) return pintarSuspension(v);
  const conQr = paquete.qr && (v.estado === 'bloqueado' || desatendido);
  let texto;
  if (desatendido) {
    texto = `<div class="estado"><span class="punto"></span>${esc(v.equipo)} · Proceso desatendido</div>
      <h1 class="titulo">No apagues ni cierres la sesión</h1>
      <p class="detalle">${v.titular ? `${esc(v.titular)} dejó` : 'Hay'} ${conPunto(`un proceso ejecutándose en este equipo${v.cuenta_hasta ? ` hasta ${cuando(v.cuenta_hasta)}` : ''}`)}
        ${v.cuenta_hasta ? `Faltan <span class="num" data-vivo="cuenta">${cuenta(v.cuenta_hasta)}</span>.` : ''} Mueve el mouse para volver al escritorio.</p>
      ${v.mensaje ? `<p class="mensaje__de">Mensaje de ${esc(v.titular ?? 'quien reservó')}</p><div class="mensaje">«${esc(v.mensaje)}»</div>` : ''}`;
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
          <div class="que">${desatendido ? '¿Necesitas este equipo? Escríbele a quien lo reservó' : 'Reserva este equipo'}</div>
          <div class="qr">${paquete.qr}</div>
          <div class="url">${enlaceCorto(v.equipo)}</div>
          ${!desatendido && paquete.nfc ? `<div class="nfc-bloqueo">${DIBUJO_NFC}<span>O acerca tu celular a la tarjeta de la base del monitor</span></div>` : ''}
          ${desatendido ? '' : '<div class="espera">Se desbloquea solo al detectar tu reserva</div>'}
        </div>` : ''}
    </div>`;
  pintarPie(v);
}

// Pantalla suspendida: los programas siguen abiertos detrás. Se quita con el código de la reserva, el QR de un
// solo uso (con la cuenta de la reserva) o una clave del personal.
function pintarSuspension(v) {
  const reserva = v.titular
    ? `La reserva de ${esc(v.titular)} sigue${v.cuenta_hasta ? ` hasta ${cuando(v.cuenta_hasta)}` : ''}: nada se cerró.`
    : 'Nada se cerró: al desbloquear todo sigue como estaba.';
  main.innerHTML = `<div class="centro">
      <div>${reloj()}
        <div class="estado"><span class="punto"></span>${esc(v.equipo)} · Pantalla suspendida</div>
        <h1 class="titulo">${v.mensaje ? 'Aviso del laboratorio' : 'El laboratorio suspendió esta pantalla'}</h1>
        ${v.mensaje ? `<div class="anuncio grande">${ICONOS.megafono}<span>${esc(v.mensaje)}</span></div>` : ''}
        <p class="detalle">${reserva}</p>
      </div>
      <div class="tarjeta">
        <div class="que">${v.con_codigo ? 'Desbloquéalo con tu reserva' : 'Desbloquéalo con tu celular'}</div>
        ${paquete.qr ? `<div class="qr">${paquete.qr}</div>
          <p class="nota">Escanéalo con ${v.titular ? 'la cuenta de la reserva' : 'tu cuenta de LADME'}. El código cambia cada minuto.</p>` : ''}
        ${v.con_codigo ? `<form class="codigo-reserva" id="form-codigo">
            <label for="codigo">O escribe el código de tu reserva</label>
            <div class="fila"><input class="campo num" id="codigo" placeholder="XXXX-XXXX" autocomplete="off" spellcheck="false" maxlength="9" />
            <button class="boton principal" type="submit">Desbloquear</button></div>
            <span class="error" id="error-codigo"></span>
            <p class="nota">Está en «Tu reserva», en la app.</p>
          </form>` : ''}
      </div>
    </div>`;
  pintarPie(v);
}

// XXXXXXXX → XXXX-XXXX mientras se escribe.
main.addEventListener('input', (e) => {
  if (e.target.id !== 'codigo') return;
  const limpio = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  e.target.value = limpio.length > 4 ? `${limpio.slice(0, 4)}-${limpio.slice(4)}` : limpio;
});
main.addEventListener('submit', async (e) => {
  e.preventDefault();
  const campo = document.getElementById('codigo');
  try {
    await invocar('quitar_suspension', { codigo: campo.value });
    campo.blur();
  } catch (err) {
    document.getElementById('error-codigo').textContent = String(err);
    campo.select();
  }
});

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
    if (paquete.vista?.pantalla === 'suspension') await invocar('quitar_suspension', { codigo: campo.value });
    else await invocar('emergencia', { claveIngresada: campo.value });
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
  // No se repinta mientras alguien escribe un código.
  if (cambio && !pidiendoClave && document.activeElement?.id !== 'codigo') pintar();
}
escuchar('faro://vista', alRecibir);
invocar('estado_inicial').then(alRecibir);
