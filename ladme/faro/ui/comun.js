// Faro · utilidades compartidas por las ventanas.
const T = window.__TAURI__;
export const invocar = (cmd, args) => T.core.invoke(cmd, args);
export const escuchar = (ev, fn) => T.event.listen(ev, (e) => fn(e.payload));

let desfase = 0;
export const fijarDesfase = (ms) => { desfase = ms || 0; };
/** Hora del servidor (corrige el reloj del PC si está desfasado). */
export const ahora = () => Date.now() + desfase;

const hora = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit' });
const fecha = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
const dia = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });

export function textoHora(iso) {
  const d = new Date(iso);
  const hoy = new Date(ahora());
  const mismoDia = d.toDateString() === hoy.toDateString();
  return (mismoDia ? '' : dia.format(d).replace('.', '') + ', ') + hora.format(d);
}
/** «las 9:00 p. m.» hoy, «el mié 18 nov, 7:22 a. m.» otro día. */
export function cuando(iso) {
  const d = new Date(iso);
  const mismoDia = d.toDateString() === new Date(ahora()).toDateString();
  return mismoDia ? `las ${hora.format(d)}` : `el ${dia.format(d).replace('.', '')}, ${hora.format(d)}`;
}
/** Agrega el punto final solo si el texto no termina ya en punto (p. ej. «p. m.»). */
export const conPunto = (t) => (t.endsWith('.') ? t : `${t}.`);
export const textoReloj = () => hora.format(new Date(ahora()));
export const textoFecha = () => {
  const f = fecha.format(new Date(ahora()));
  return f.charAt(0).toUpperCase() + f.slice(1);
};

/** Cuenta regresiva compacta: 2 d 4 h · 1:05:09 · 04:59. */
export function cuenta(iso) {
  let s = Math.max(0, Math.floor((new Date(iso).getTime() - ahora()) / 1000));
  const d = Math.floor(s / 86400);
  if (d >= 1) return `${d} d ${Math.floor((s % 86400) / 3600)} h`;
  const h = Math.floor(s / 3600);
  s %= 3600;
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
}

export function progreso(desde, hasta) {
  if (!desde || !hasta) return null;
  const a = new Date(desde).getTime();
  const b = new Date(hasta).getTime();
  if (b <= a) return null;
  return Math.min(1, Math.max(0, (ahora() - a) / (b - a)));
}

export const esc = (t) =>
  String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const ICONOS = {
  reloj: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  mas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  salir: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>',
  falla: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/></svg>',
  cerrar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m18 15-6-6-6 6"/></svg>',
  volver: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m15 18-6-6 6-6"/></svg>',
  enlace: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/></svg>',
  llave: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M17 6l3 3M14 9l2 2"/></svg>',
  llaveInglesa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/></svg>',
  candado: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
};
