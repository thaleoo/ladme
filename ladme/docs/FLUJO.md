# Cómo se trabaja y se publica

`main` es producción: la app que usa todo el laboratorio (Cloudflare Pages publica `main` en
ladme.pages.dev) y la fuente de las versiones de Faro que se instalan solas. Nada llega a `main` sin
haberse probado antes.

## Ramas

| Rama | Para qué |
| --- | --- |
| `main` | Producción. Solo recibe Pull Requests desde `dev` con el CI en verde. |
| `dev` | Donde se aplican las entregas (`git am`). Cada push corre el CI (pruebas de Rust, de la base de datos y build de la PWA). |
| `experimental` u otras | Pruebas sueltas que quizá no lleguen a `dev`. |

Proteger `main` (una sola vez): GitHub → Settings → Branches → Add rule → `main` → «Require a pull request
before merging» y «Require status checks to pass» (Faro / pruebas, PWA / build, PWA / base-de-datos).

## Una entrega, paso a paso

1. Aplicar en `dev`:
   ```
   git switch dev
   git pull
   git am ~/Downloads/00NN-*.patch
   git push
   ```
2. Esperar el CI de ese push (pestaña Actions). Si falla, no seguir: mandar el error.
3. Si la entrega trae migración (`ladme/db/migrations/00NN_*.sql`): ejecutarla primero en la base de
   pruebas si existe; en producción, justo antes del paso 6.
4. **Faro**, si cambió: publicar en el canal de pruebas
   ```
   git tag faro-pruebas-vX.Y.Z
   git push origin faro-pruebas-vX.Y.Z
   ```
   Solo lo reciben los equipos marcados «pruebas» en Administración → Faro (por ejemplo, un Fedora y un
   Windows). Probar ahí lo que trae la entrega.
5. **PWA**, si cambió: revisar la vista previa de `dev` en Cloudflare Pages (dev.ladme.pages.dev, si
   la integración con GitHub está activa).
6. Todo bien: Pull Request `dev` → `main` en GitHub y fusionar.
7. Faro estable, si cambió (desde `main`, con la versión igual a la de `tauri.conf.json`):
   ```
   git switch main
   git pull
   git tag faro-vX.Y.Z
   git push origin faro-vX.Y.Z
   ```

## Releases de Faro

- Los Faro instalados solo miran la release marcada «Latest»: nunca bajan de versión.
- Conviene dejar solo la última release estable (y la fija `faro-pruebas`). Para borrar una vieja con
  su etiqueta: `gh release delete faro-vX.Y.Z --repo thaleoo/ladme --cleanup-tag --yes`.
- Nunca borrar la release «Latest» antes de que exista la siguiente.

## Base de datos de pruebas (recomendado)

Hoy las migraciones van directo a la base real. Con un segundo proyecto de Supabase (gratis) y las
variables de la PWA de vista previa en Cloudflare (Settings → Environment variables → Preview:
`VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` del proyecto de pruebas), `dev` se prueba completo sin
tocar datos reales.
