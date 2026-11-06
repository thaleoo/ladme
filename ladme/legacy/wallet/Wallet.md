# Guía de Google Wallet para LADME

Si no configura nada de esto, **la app funciona igual**: el botón de Wallet simplemente no aparece.

## A. Configuración (una sola vez; puede empezar con su cuenta personal)

1. **Cuenta de emisor.** Entre a la *Google Pay & Wallet Console* con su cuenta de Google y cree la cuenta de emisor de Google Wallet. Copie el **ID de emisor** (Issuer ID).
2. **Google Cloud.** Cree un proyecto, habilite la **Google Wallet API**, cree una **cuenta de servicio** y descargue su **clave JSON**. Guarde ese archivo en un lugar privado (no en Drive compartido, no por correo, no en el chat).
3. **Autorizar la cuenta de servicio.** En la consola de Wallet, en la sección de usuarios, autorice el correo de la cuenta de servicio (`client_email` del JSON).
4. **Modo de prueba.** En la consola de Wallet agregue como **cuentas de prueba** los correos de Google de quienes van a probar (usted y 2 o 3 personas más). Hasta que Google apruebe el acceso de publicación, solo esas cuentas pueden guardar los pases.
5. **Propiedades del script** (Apps Script → Configuración del proyecto → Propiedades del script):

   | Propiedad | Valor |
   |---|---|
   | `WALLET_ISSUER_ID` | el ID de emisor |
   | `WALLET_SA_EMAIL` | `client_email` del JSON |
   | `WALLET_SA_KEY` | `private_key` del JSON, tal cual (sirve con los `\n` escritos) |
   | `WALLET_LOGO_URL` | URL pública del logo (opcional) |
   | `WALLET_WIDE_LOGO_URL` | URL pública del logo ancho (opcional) |
   | `WALLET_HERO_URL` | URL pública del banner (opcional) |
   | `WALLET_DESACTIVADO` | `1` para apagar Wallet sin borrar nada (opcional) |

6. **Imágenes.** Están en la carpeta `wallet_imagenes/` (o regenérelas con `generar_imagenes_wallet.py`). Súbalas a una URL pública HTTPS estable y compruebe que se abren en una ventana de incógnito.
7. **Autorizar y crear la clase.** Guarde el código nuevo y, en el editor, ejecute `walletConfigurarClase`. Acepte los permisos nuevos (conexión a servicios externos). Debe decir «Clase de Wallet creada con plantilla de filas». Si dice «SIN plantilla», Google rechazó el diseño de filas y el pase usa el diseño por defecto; funciona igual.
8. **Probar.** Ejecute `walletPrueba`, copie el enlace del registro y ábralo en un Android con una cuenta de prueba.
9. **Desplegar con la cuenta del laboratorio** (Implementar → Gestionar implementaciones → Nueva versión). Ver la sección C.

## B. Cómo funciona

- El correo de confirmación y la ficha del titular traen **Agregar a Google Wallet**.
- El pase muestra equipo, desde, hasta, ubicación y actividad. **No lleva nombre, cédula ni correo.** Su QR y su enlace abren la ficha del equipo (liberar o extender).
- **Se actualiza solo** (si la persona ya lo guardó) cuando la reserva se extiende, se libera o se cancela.
- Pendiente para el lote de alertas: avisos push con mensajes de Wallet (Google permite como máximo 3 por pase cada 24 horas).

## C. Importante: de qué cuenta salen los correos

Con «Ejecutar como: Yo», los correos salen **de la cuenta que hizo el último despliegue**, no de la lista de administradores. Para que sigan saliendo de `labdatos_paz@unal.edu.co`:

1. Abra el proyecto de Apps Script **iniciando sesión con esa cuenta** (ventana de incógnito).
2. Implementar → Gestionar implementaciones → lápiz → **Nueva versión** → Implementar.
3. Compruebe que en la ventana dice «Ejecutar como: labdatos_paz@unal.edu.co». El panel admin deja de mostrar la alerta roja.

Regla de oro: **siempre se despliega con la cuenta del laboratorio.** Las demás personas pueden editar el código, pero no desplegar.

## D. Pasar a producción o a una cuenta institucional

- Solicite en la consola el **acceso de publicación**; Google lo revisa. Para esa revisión use los botones oficiales de «Agregar a Google Wallet» y revise sus guías de marca.
- Para cambiar de cuenta de emisor: nuevo ID de emisor, nueva cuenta de servicio, cambiar las tres propiedades y ejecutar `walletConfigurarClase`. Los pases de la cuenta anterior dejan de actualizarse, pero son de corta vida (reservas de horas o días).
- Para iPhone no hay pase (Apple Wallet es un proceso aparte). Siguen funcionando el correo y el botón de calendario.

## E. Seguridad

- La clave privada vive **solo** en Propiedades del script. Quien edite el proyecto puede verla: cámbiela cuando cambien los responsables.
- Si se filtra, revoque la clave en Google Cloud (IAM → cuentas de servicio → claves) y genere otra.
- El registro de ejecución nunca imprime la clave ni los enlaces firmados.