# Concurso del año

Pulsador de concurso con móviles, estilo Kahoot. La pantalla del presentador se ve en la tele (portátil
conectado por HDMI); cada jugador usa su móvil como pulsador, sin instalar nada. Web 100 % estática
(GitHub Pages) con WebRTC mediante [PeerJS](https://peerjs.com/).

> Estado: **fase 6** — concurso por secciones con equipos, cargado desde una hoja de cálculo; la tele es el
> espectáculo y el presentador lo maneja desde su móvil. Se juegan **Pulsador**, **Test** (con comodines),
> **Verdad o mentira**, **Dos verdades y una mentira**, **¿Quién es más probable…?**, **Estimación**,
> **Parar el contador**, **Duelo de reflejos** y **Libre** (pruebas tipo «Fit o Fat» con cronómetro o contador).

## Preparar el concurso

1. Descarga la plantilla: en la tele, pantalla de preparación → **Descargar plantilla** (o
   `public/plantilla-concurso.xlsx`). Ábrela con Excel o Google Sheets (para cargarla: Archivo → Descargar → .xlsx).
2. Rellénala: pestaña **Concurso** (secciones en orden), **Equipos** (vacía = sin equipos), **Ajustes** y una
   pestaña por tipo de sección. La pestaña **Instrucciones** lo explica, y trae un ejemplo de cada tipo.
3. En la tele, **Cargar concurso** (o arrastra el archivo a la pantalla). Si algo está mal, dice la pestaña y la fila.

## Cómo se juega

1. Abre `host.html` en el portátil conectado a la tele y pon la ventana a pantalla completa.
2. **Tu móvil como mando:** escanea el QR «Mando del presentador» de la pantalla de preparación y confirma en el
   portátil (Enter). Desde entonces tu móvil se reconecta solo. Ves cada pregunta con su respuesta antes de lanzarla.
3. Los jugadores escanean el QR grande, eligen nombre e icono y, si hay equipos, su equipo (color del equipo).
   Comprueba los equipos en la tele (se puede mover a alguien) y pulsa **Empezar concurso**: los equipos se cierran.
4. Portada → presentación de cada sección → preguntas → marcador → … → final con podios.
5. En el **Pulsador**: «Mostrar pregunta» (la pone en grande en la tele), «Abrir turno» → a los 300 ms tele y
   móviles pasan a **¡Pulsad!** a la vez. La primera pulsación llena la tele con el ganador, su tiempo y el orden de
   los siguientes (con «casi empate» si la diferencia es menor de 30 ms). Luego **Acierto** (suma los puntos de la
   sección) o **Fallo: rebote al resto** (bloquea a quien falló y reabre el turno), «Mostrar respuesta» y
   «Siguiente pregunta».
6. Quien pulse antes de abrir el turno queda **bloqueado** en esa pregunta (se puede desactivar en **Ajustes** o
   perdonar con «Desbloquear»).

7. En las secciones de **respuestas** (Test, Verdad o mentira, Dos verdades, Votación, Estimación) todos responden a
   la vez desde el móvil: «Abrir respuestas» → cuenta atrás (se cierra sola al acabar o cuando han respondido todos)
   → «Revelar» (respuesta correcta, recuento, quién suma) → «Siguiente pregunta». La primera respuesta es la buena.
   - **Comodines** (solo en Test, antes de responder): **50 %** quita la mitad de las incorrectas, **×2** dobla los
     puntos si aciertas, **Público** enseña en directo qué responden los demás. Uno de cada para todo el concurso,
     por equipo (o por jugador si no hay equipos).
   - **Votación**: nadie puede votarse; suman quienes votan al más votado (con empate, a cualquiera de los empatados).
   - **Estimación**: puntos por puestos según la columna Puntos (p. ej. 3,2,1); «Sin pasarse» deja fuera a quien se pasa.
   - **Dos verdades y una mentira**: el protagonista (su nombre debe coincidir con el de su jugador) no vota y suma
     1 punto por cada uno al que engaña.
   - En el móvil, la respuesta se elige con un toque y se **confirma tocando otra vez la misma**.
   - «Reiniciar pregunta» después de revelar quita los puntos que dio esa pregunta.
8. **Parar el contador**: «¡Empezar!» → cuenta atrás 3-2-1 → el reloj corre en la tele y en los móviles (visible, a
   ciegas o desaparece a los N segundos, según la fila) → cada uno pulsa STOP → «Revelar» ordena por cercanía al
   objetivo. Cuenta el instante exacto del toque con el reloj sincronizado.
9. **Duelo de reflejos**: «Poner en rojo» → entre 2 y 6 s después, al azar, todo se pone verde (tele y móviles a la
   vez) → gana la reacción más rápida. Quien pulsa en rojo queda fuera de esa ronda. En modo «Duelo», el presentador
   elige en el mando a los dos que juegan.
10. **Libre** («Fit o Fat»): cada fila es una prueba. En el mando marcas quién participa (jugadores o equipos, según
    la columna Participan) y la tele la presenta.
    - **Cronómetro**: «¡Empezar!» y, cuando alguien cae, «Eliminado» (con «Deshacer» por si te equivocas). Al caer el
      último se para solo. Gana quien más aguanta.
    - **Contador**: botones −/+ por participante y números en grande en la tele; «Parar» cuando acabe el tiempo.
    - **Ninguna**: eliges al ganador directamente.
    - El mando propone el ganador (puedes cambiarlo o marcar varios) y «Dar puntos»: a cada jugador o, si participan
      equipos, al equipo entero.

El mando tiene tres pestañas: **Juego** (lo que toca ahora), **Jugadores** (puntos ±, puntos de equipo, mover de
equipo, quitar) y **Secciones** (saltar a cualquiera).

Teclado del portátil (por si el mando falla): **Espacio** (abrir turno / siguiente), **← →**, **P** pregunta,
**V** respuesta, **A** acierto, **F** fallo, **R** reiniciar, **M** marcador, **D** depuración. En **Ajustes** se
cambian el umbral de casi empate, la ventana de decisión y la apertura programada.

## Justicia en los tiempos

Cada móvil tiene una conexión distinta: uno puede tardar 5 ms en hacer llegar su pulsación y otro 150 ms
(los móviles en ahorro de energía responden lento a la wifi). Si ganara quien **llega** antes, ganaría el de mejor
conexión. Por eso:

1. **Sincronización de relojes.** Al conectar, cada 15 s y al volver a primer plano, el móvil intercambia mensajes con
   el presentador al estilo NTP: anota cuándo sale cada mensaje y cuándo vuelve, y el presentador cuándo llega y
   cuándo contesta. Con 10 muestras se queda con las 3 más rápidas (las que no se han quedado esperando en la red) y
   calcula la diferencia entre los dos relojes (*offset*).
2. **La pulsación lleva su hora.** El móvil manda el instante exacto en que el dedo tocó la pantalla
   (`event.timeStamp`), traducido al reloj del presentador.
3. **Ventana de decisión.** El presentador espera 150 ms tras la primera pulsación que llega antes de declarar
   ganador, para que entren pulsaciones anteriores que viajaban más despacio. Luego ordena por la hora de pulsación.
4. **Apertura programada.** «Abrir turno» se programa 300 ms en el futuro y cada móvil lo traduce a su reloj: la tele
   y todos los móviles cambian a «¡Pulsad!» a la vez, sin que el de peor conexión lo vea más tarde.

### Límites y margen de error

| Fuente de error | Magnitud típica | ¿Se corrige? |
|---|---|---|
| Asimetría de la red al sincronizar (ida ≠ vuelta) | wifi: ±1–5 ms (peor caso ±10 ms) | Se acota: el error nunca supera la mitad del RTT de la mejor muestra; el panel D lo muestra por jugador |
| **Pantalla táctil y sistema** (del dedo al evento) | 10–60 ms, distinto en cada modelo | **No**: el navegador no puede saberlo. Es la mayor fuente de error |
| Resolución del reloj del navegador | 0,1–1 ms | Despreciable |
| Deriva entre relojes | < 1 ms entre resincronizaciones | Sí (resincronización cada 15 s) |
| Móvil bloqueado / app en segundo plano | El reloj puede pararse | Resincroniza al volver |
| Pulsación que llega más de 150 ms tarde | Rara en wifi | Entra en la lista, pero no quita el puesto al ganador; el panel D la marca |

**En la práctica:** con todos en la misma wifi, el orden es fiable cuando la diferencia supera **30–50 ms**. Por
debajo de eso decide más el hardware de cada móvil que el jugador: por eso se marca «casi empate» por debajo de
30 ms. Sin sincronizar, ordenando por llegada, el sesgo entre un móvil rápido y uno lento era de 50–200 ms.

### ¿Se puede hacer trampa?

Sí, y es fácil para quien sepa programar: la hora de la pulsación la pone el móvil. Abriendo la página de jugador
en un ordenador, con una línea en la consola del navegador se puede enviar una pulsación con la hora adelantada.
El presentador **recorta** lo físicamente imposible (una pulsación anterior a su llegada en más de 250 ms o del
doble del RTT, o posterior a su llegada), así que la ventaja máxima de un tramposo queda en unos 250 ms, y el panel
D marca esas pulsaciones como «recortadas». Impedirlo del todo es imposible sin confiar en el reloj del móvil:
lo único que no se puede falsear es el orden de llegada, que es justo lo que no es justo. Entre amigos, suficiente.

## Requisitos

- Node.js 22.12 o superior (probado con 24 LTS) y Git.
- Portátil y móviles **en la misma wifi**.
- Navegadores actuales: Chrome, Safari (iOS 16.4+) o Firefox.

## Probar en local

```bash
npm install
```

```bash
npm run dev
```

Vite muestra dos direcciones:

```
➜  Local:   https://localhost:5173/
➜  Network: https://192.168.1.50:5173/
```

1. En el portátil abre **la dirección Network** + `host.html` (por ejemplo `https://192.168.1.50:5173/host.html`).
   No uses `localhost`: el QR apuntaría a `localhost` y los móviles no podrían abrirlo.
2. El navegador avisará de que el certificado no es de confianza (es autofirmado, lo genera
   `@vitejs/plugin-basic-ssl`). Pulsa «Configuración avanzada → Continuar».
3. En el móvil escanea el QR. Saldrá el mismo aviso de certificado: acéptalo (Chrome: «Configuración avanzada →
   Acceder»; Safari: «Mostrar detalles → visitar este sitio web»).
4. Elige nombre, color e icono y pulsa **Entrar**. Debe aparecer en la tele con su latencia.

¿Por qué HTTPS? Los móviles solo permiten Wake Lock y otras API en contexto seguro, y `localhost` no sirve
desde otro dispositivo.

Si Windows pregunta por el firewall al arrancar Vite, permite el acceso en **redes privadas**.

Para probar sin móvil: abre `host.html` en una pestaña y la dirección del QR en otras. Dos pestañas del mismo
navegador serían el mismo jugador (comparten localStorage), así que añade `&perfil=2`, `&perfil=3`… a la dirección
de cada pestaña de jugador. Si solo vas a usar el portátil, `npm run dev:http` arranca sin certificado en
`http://localhost:5174/host.html`.

### Tests

```bash
npm test
```

Cubren la lógica que no depende de la red (`src/core`, `src/shared`).

### Qué probar en la fase 3

- Abrir el panel **D**: cada jugador debe mostrar «Error sinc.» de pocos ms y 10 o más muestras.
- Pulsar con dos móviles casi a la vez: en el panel, «Pulsó» decide el orden aunque «Llegó» diga otra cosa.
- Bloquear un móvil, desbloquearlo y comprobar que vuelve a sincronizar (las muestras empiezan de nuevo).

### Qué probar en la fase 2

- Abrir turno, pulsar con dos móviles casi a la vez y ver el orden y el «casi empate».
- Fallo → rebote: el que falló queda bloqueado y los demás vuelven a pulsar.
- Pulsar en «Pregunta en el aire»: queda bloqueado esa pregunta.
- Quitar la wifi a un móvil en mitad de una pregunta y devolvérsela.

### Qué probar en la fase 1

- Entrar con 2+ móviles; nombres repetidos («Ana (2)») y la misma pareja color+icono (se asigna otra).
- Botones +/− del marcador y ✕ para quitar a alguien.
- Bloquear el móvil o cambiar de app y volver: debe reconectar solo y conservar los puntos.
- Recargar la página del presentador: recupera la sala y los móviles vuelven solos (puede tardar unos segundos
  mientras el servidor de PeerJS libera el código).
- Apagar la wifi del portátil: aparece el aviso de servidor de enlace.

## Desplegar en GitHub Pages

1. Crea un repositorio vacío en GitHub (por ejemplo `concurso`), sin README.
2. Conecta y sube el código:

   ```bash
   git remote add origin https://github.com/TU_USUARIO/concurso.git
   ```

   ```bash
   git push -u origin main
   ```

3. En GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Cada push a `main` ejecuta `.github/workflows/deploy.yml` (tests + build + publicación). Al terminar, la web
   queda en `https://TU_USUARIO.github.io/concurso/`:
   - Presentador: `https://TU_USUARIO.github.io/concurso/host.html`
   - Jugadores: escanean el QR o abren `https://TU_USUARIO.github.io/concurso/` y escriben el código.

## Cómo funciona

Ver [CLAUDE.md](CLAUDE.md) para las decisiones, el protocolo de mensajes y el algoritmo de sincronización.

- El presentador registra en el servidor público de PeerJS el ID `concurso-del-ano-v1-<CÓDIGO>`; los móviles se
  conectan a ese ID. Después la comunicación es directa (P2P) dentro de tu wifi.
- Si el servidor de PeerJS cae, las conexiones ya abiertas siguen funcionando; solo no puede entrar gente nueva.
