import { invocar, LOGO } from './comun.js';
document.getElementById('marca').insertAdjacentHTML('afterbegin', LOGO);
const form = document.getElementById('form');
const campo = document.getElementById('codigo');
const error = document.getElementById('error');
const boton = form.querySelector('button');
campo.addEventListener('input', () => {
  const v = campo.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  campo.value = v.length > 4 ? `${v.slice(0, 4)}-${v.slice(4)}` : v;
  error.textContent = '';
});
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (campo.value.replace('-', '').length !== 8) { error.textContent = 'El código tiene 8 caracteres.'; return; }
  boton.disabled = true; boton.textContent = 'Vinculando…';
  try {
    const equipo = await invocar('vincular', { codigo: campo.value });
    document.querySelector('main').innerHTML = `<div class="listo"><div class="ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg></div>
      <h1>Listo: este PC es ${equipo}</h1><p>Faro ya está activo. Mira la isla en la parte superior de la pantalla.</p></div>`;
    setTimeout(() => invocar('cerrar_vincular'), 2600);
  } catch (err) {
    error.textContent = String(err);
    boton.disabled = false; boton.textContent = 'Vincular';
    campo.select();
  }
});
campo.focus();
