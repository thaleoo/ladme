// Arma latest.json para el actualizador de Faro a partir de los instaladores firmados.
// Uso: node latest-json.mjs <carpeta> <version> <url_base_de_descarga>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [carpeta, version, base] = process.argv.slice(2)
if (!carpeta || !version || !base) {
  console.error('Uso: node latest-json.mjs <carpeta> <version> <url_base>')
  process.exit(1)
}
const archivos = readdirSync(carpeta)
const plataformas = {}
const agregar = (clave, patron) => {
  const nombre = archivos.find((a) => patron.test(a) && !a.endsWith('.sig'))
  if (!nombre || !archivos.includes(`${nombre}.sig`)) return
  plataformas[clave] = {
    signature: readFileSync(join(carpeta, `${nombre}.sig`), 'utf8').trim(),
    url: `${base.replace(/\/$/, '')}/${encodeURIComponent(nombre)}`
  }
}
// Solo instalaciones que se actualizan sin contraseña de administrador.
agregar('windows-x86_64-nsis', /windows-x64-setup\.exe$/)
agregar('linux-x86_64-appimage', /linux-x86_64\.AppImage$/)
if (Object.keys(plataformas).length === 0) {
  console.error('No hay instaladores firmados (.sig): ¿falta el secreto TAURI_SIGNING_PRIVATE_KEY?')
  process.exit(1)
}
const manifiesto = { version, notes: `Faro ${version}`, pub_date: new Date().toISOString(), platforms: plataformas }
writeFileSync(join(carpeta, 'latest.json'), JSON.stringify(manifiesto, null, 2))
console.log(`latest.json con ${Object.keys(plataformas).join(', ')}`)
