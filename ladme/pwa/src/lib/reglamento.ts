/**
 * Reglas de uso del laboratorio. La versión vigente vive en la base de datos (Administración → Herramientas →
 * Reglamento) y se edita desde allí; este texto solo se muestra si la base de datos no responde.
 * Marcas: **negrita**, {tolerancia} (minutos para registrar la llegada) y {software_dias} (días hábiles para pedir software).
 */
export interface Regla {
  titulo: string
  texto: string
}

export const REGLAMENTO_POR_DEFECTO: Regla[] = [
  {
    "titulo": "Un papel no reserva nada",
    "texto": "Para apartar un equipo se usa **únicamente la plataforma LADME** (ladme.pages.dev). Una hoja pegada en un equipo no es una reserva. Si un equipo figura reservado en un papel pero no tiene reserva en LADME, avise a un laboratorista: retirará el papel y revisará los procesos en ejecución. Después haga su reserva en LADME y podrá usar el equipo."
  },
  {
    "titulo": "La reserva es personal",
    "texto": "Reserve solo para su propio trabajo académico o de investigación. No preste su credencial, no reserve a nombre de otra persona ni aparte equipos «por si acaso». Usted responde por el equipo durante su reserva."
  },
  {
    "titulo": "Registre su llegada a tiempo",
    "texto": "Registre su llegada en LADME dentro de los **{tolerancia} minutos** de tolerancia de su reserva. Si no lo hace, la reserva puede liberarse y contarse como inasistencia. Si algo se lo impide, repórtelo desde el sistema de inasistencias o hable con un laboratorista."
  },
  {
    "titulo": "Libere o cancele lo que no use",
    "texto": "Si no va a usar el equipo, cancele la reserva. Si termina antes, libérelo desde LADME o desde Faro para que otra persona pueda usarlo. Si necesita más tiempo, extienda la reserva antes de que termine y mientras el equipo siga libre."
  },
  {
    "titulo": "Faro no se toca",
    "texto": "Faro es el programa que gestiona los equipos del laboratorio. **No cierre, detenga ni desinstale sus procesos**, ni intente evitar sus avisos o el bloqueo de pantalla. Atienda sus anuncios y, cuando termine su reserva, guarde su trabajo. Incumplir esta norma puede acarrear sanciones."
  },
  {
    "titulo": "Uso compartido y procesos de otras personas",
    "texto": "En un equipo en uso compartido, **nunca apague ni reinicie el equipo, no cierre la sesión y no cierre los programas o procesos que protegió quien hizo la reserva original**. Use solo lo que quede libre. Si necesita el equipo y hay un proceso desatendido, no lo interrumpa: escriba al titular desde la ficha del equipo o avise a un laboratorista."
  },
  {
    "titulo": "Cuide los equipos",
    "texto": "No mueva los equipos ni desconecte cables o periféricos, y no consuma alimentos ni bebidas cerca de ellos. Deje el puesto ordenado y avise de inmediato si algo se daña o falta."
  },
  {
    "titulo": "Software",
    "texto": "No instale programas por su cuenta. Si necesita uno, solicítelo desde LADME con al menos **{software_dias} días hábiles** de anticipación. Use solo software con licencia o de uso libre."
  },
  {
    "titulo": "Sus archivos y sus cuentas",
    "texto": "Guarde su trabajo en su propio almacenamiento o en la nube: el laboratorio puede limpiar los discos durante un mantenimiento o al terminar su sesión. Al irse, cierre la sesión de su correo, de la nube y de cualquier cuenta personal, y no guarde contraseñas en el navegador."
  },
  {
    "titulo": "Reporte las fallas",
    "texto": "Si algo no funciona, repórtelo desde la ficha del equipo en LADME o desde Faro. No intente repararlo por su cuenta."
  },
  {
    "titulo": "Convivencia en la sala",
    "texto": "La sala es un espacio de trabajo compartido: mantenga el volumen bajo, use audífonos para audio y videollamadas, y trate con respeto a las demás personas usuarias y al personal."
  },
  {
    "titulo": "Sus datos",
    "texto": "El laboratorio guarda su nombre, correo institucional, programa y el historial de sus reservas para operar el servicio y elaborar estadísticas de uso."
  },
  {
    "titulo": "Si no se cumplen las reglas",
    "texto": "Incumplir estas reglas puede llevar a perder reservas, a suspender su acceso a LADME o a otras medidas que determine la coordinación del laboratorio. Las reglas pueden actualizarse: cuando cambien de fondo se le pedirá que las lea de nuevo."
  }
]
