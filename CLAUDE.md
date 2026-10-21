# Concurso del año — pulsador con móviles

Web 100 % estática (GitHub Pages) para concursos en casa. El presentador (portátil conectado a la tele)
crea una sala; cada jugador usa su móvil como pulsador. Comunicación WebRTC con PeerJS usando el
servidor de enlace público (`0.peerjs.com`). **El presentador es la autoridad**: decide ganador, puntos y estado.

## Comandos

- `npm run dev` — servidor Vite con HTTPS autofirmado, accesible desde la LAN (`--host`).
- `npm test` — tests (Vitest) de la lógica pura en `src/core` y `src/shared`.
- `npm run build` — genera `dist/`. El despliegue lo hace `.github/workflows/deploy.yml` al hacer push a `main`.
- `npm run plantilla` — regenera `public/plantilla-concurso.xlsx` (script `scripts/make-template.mjs`, ExcelJS solo en desarrollo).
  Un test comprueba que la plantilla se lee sin errores ni avisos: si se cambian columnas, cambiar a la vez `src/core/show.js`.

En este Windows, Node y Git se instalaron con winget; si una terminal antigua no los encuentra, refrescar `PATH`.
Ojo con PowerShell 5.1: `Get-Content`/`Set-Content` sin `-Encoding` rompen los acentos (leen ANSI, escriben BOM). Editar con las herramientas de archivo.
`npm run dev:http` (puerto 5174, sin certificado) sirve para probar en el navegador del portátil.

## Decisiones

- **Vite + Vitest**, sin frameworks. JS plano con módulos ES. Dependencias con versión exacta (`.npmrc` → `save-exact`), lockfile versionado, `npm ci` en CI.
- `base: './'` → funciona bajo cualquier nombre de repositorio en Pages.
- Páginas: `index.html` = jugador (URL corta para teclear), `host.html` = tele (autoridad), `control.html` = mando del presentador.
- Idioma: identificadores en inglés; comentarios, documentación e interfaz en español.
- Código de sala: 4 caracteres del alfabeto `ACDEFGHJKMNPRTUVWXY23479` (de cada pareja confusa queda como mucho uno: sin O/0/Q, I/1/L, S/5, B/8, 6, Z).
- ID PeerJS del presentador: `concurso-del-ano-v1-<CÓDIGO>` (prefijo porque el servidor público es compartido). Los jugadores usan IDs aleatorios.
- Jugadores: mínimo 2 para jugar, máximo 20. Identidad = `playerId` (UUID en localStorage del móvil), no el nombre.
  - Nombre repetido → el presentador lo renombra a "Ana (2)".
  - Sin equipos, cada jugador elige **color + icono** y la **pareja** es única en la sala. Con equipos, el color es el del
    equipo y el icono es único dentro del equipo. Si choca, el presentador asigna otro libre y avisa.
  - Iconos: solo animales (emoji), en `src/shared/appearance.js`; para añadir, al final (los ids se guardan).
- Puntos: los de cada sección (columna Puntos de la hoja) y "Puntos por fallo" de Ajustes; además +/− manual por jugador
  y por equipo. Comodines: 1 de cada (50 %, Doble, Público) por equipo, o por jugador si no hay equipos.
- Pulsar antes de abrir el turno bloquea al jugador durante esa pregunta (opción activada por defecto).
- Todos los jugadores estarán en la misma wifi (no se optimiza para datos móviles / TURN).
- Sin vibración en iPhone (Safari no la soporta): aceptado.

## Arquitectura

- `src/core/` — lógica pura, sin DOM ni red, con tests: roster (jugadores y equipos), concurso y lectura de la hoja
  (`show.js`), recorrido de pantallas (`runner.js`), motor del pulsador (`game.js`), ranking, sincronización y plausibilidad.
- `src/shared/` — protocolo, código de sala, configuración PeerJS, apariencias, almacenamiento seguro, formato de tiempos.
- `src/host/` — tele: `room.js` (controlador: une todo, órdenes en `run(action, args)`), `screens.js` + `stage.js`
  (pantallas), `main.js` (pintado, teclado, importar), persistencia (`concurso.host.v2`). Las conexiones entran por
  `sources/peerSource.js` (jugadores y mandos); fase futura: mandos físicos (Gamepad API) con offset 0.
- `src/player/` — móvil del jugador: reconexión, sincronización, botón, elegir equipo.
- `src/control/` — mando del presentador: pestañas Juego / Jugadores / Secciones; manda órdenes `cmd` y pinta `controlState`.

### Protocolo (JSON por DataConnection fiable, campo `t` = tipo; `PROTOCOL_VERSION` = 2)

Jugador → tele: `hello {v, role:'player', playerId, name, color, icon, teamId}`, `profile {name, color, icon, teamId}`,
`hbAck {h0}`, `buzz {seq, epoch, tLocal?, offset?, err?}` (sin offset → cuenta la llegada),
`answer {seq, roundId, value, tLocal?, offset?, err?}` (value = índice de opción, playerId votado o número),
`joker {seq, roundId, kind}`, `sync {id, t0}`, `syncReport {offset, err, rtt, samples}`.

Tele → jugador: `welcome {you, adjusted}`, `state {room, title, playerCount, minPlayers, taken, teams, teamsLocked, you,
screen, section, game, winner, answer, free, standings}` (`section` = nombre, tipo, descripción, puntos, nº de sección y de
pregunta, para la barra de sección del móvil; `standings` = equipos y jugadores con puntos, para el marcador que se abre
sin salir del juego) (foto completa y personalizada; `game` = `playerView()` solo en una pregunta de
pulsador; `answer` solo en una pregunta de respuestas), `hb {h0}` cada 2 s, `buzzAck {seq, result}`,
`answerAck {seq, result, message?}` (respuestas y comodines), `syncReply {id, t0, t1, t2}`,
`error {code, message}` (`room-full`, `version`, `removed`, `replaced`, `control-denied`).

Mando ↔ tele: `hello {v, role:'control', controlId, token, deviceName}` → `controlStatus {status: pending|approved}`;
luego `controlState {view}` (vista completa con respuestas, agrupada cada 150 ms) y `cmd {id, action, args}` →
`cmdResult {id, ok, error}`. Las órdenes son las de `HostRoom.run()`: next, prev, nextItem, gotoSection, endSection,
scoreboard, toSetup, showQuestion, showAnswer, open, correct, wrong, restart, unlock, openAnswers, closeAnswers, reveal, setDuel,
freeParticipants, freeStart, freeOut, freeRevive, freeCount, freeStop, freeAward,
lockTeams, moveTeam, adjustScore, adjustTeamBonus, resetScores, removePlayer, approveControl, denyControl, updateSettings.

- Emparejar mando: la tele (preparación) enseña un QR a `control.html?sala=CÓDIGO#k=CLAVE` (la clave tras `#` no sale del
  navegador); con la clave correcta, el portátil pide confirmación (Enter / Esc). Los mandos aprobados se recuerdan.
  Sala nueva = clave nueva.

- Mismo `playerId` desde otra conexión (otra pestaña): la vieja recibe `replaced` y deja de reconectar; si no, se echarían mutuamente.
- `?perfil=X` en la página del jugador usa otra identidad (clave de localStorage distinta): para probar varios jugadores en un navegador.

### Motor de preguntas (`src/core/game.js`)

Fases `idle` ("Pregunta en el aire") → `open` (apertura programada en `tOpen`) → `result` (ganador; `judged` = correct) o,
tras "Fallo" sin nadie más, `closed`. "Fallo" bloquea al ganador y abre una ronda nueva para el resto (todos vuelven a pulsar).
`epoch` crece con cada apertura, reinicio (R) y pregunta nueva; el móvil manda la época que veía al pulsar. Una pulsación
de época vieja se descarta (`stale`, sin bloquear) salvo que caiga dentro del turno abierto ahora (`tPress ≥ tOpen`).
El móvil envía también en "Espera": decide el presentador (antes de tiempo → bloqueo si la opción está activa).
`tPress` lo calcula `peerSource.js` con `resolvePressTime()` (marca sincronizada, o llegada si el móvil aún no está sincronizado).
### Secciones de respuestas (`src/core/answers.js`)

Test, Verdad o mentira, Dos verdades y una mentira, Votación y Estimación comparten `AnswerRound`:
`ready` → `open` (apertura programada; plazo = `tOpen + segundos`) → `closed` (al acabar el tiempo + 500 ms de gracia, o
en cuanto responden todos los conectados) → `revealed` (`scoreRound()` y se suman los puntos). Primera respuesta definitiva;
vale si `tPress` (sincronizado, `resolvePressTime`) ≤ plazo. Cada pregunta tiene `roundId` (`playKey#n`): respuestas de otra
ronda → `closed`. Puntos: acierto = `points[0]` (×2 con Doble); Votación: quien vota a un más votado (empates incluidos;
nadie se vota a sí mismo); Estimación: por cercanía, puestos densos con `points[puesto-1]`, "sin pasarse" excluye a quien
se pasa; Dos verdades: el protagonista (jugador cuyo nombre coincide con "Sobre quién") no vota y suma 1 por engañado.
En el móvil, opciones y votos se eligen con un toque y se confirman tocando otra vez la misma.

**Secciones de tiempo** (mismo `AnswerRound`; la "respuesta" es el instante del toque, `pointerdown` + `event.timeStamp`):
- **Contador**: `tOpen = ahora + 3 s` (cuenta atrás 3-2-1); valor = segundos desde `tOpen`; pulsar en la cuenta atrás → `early`
  sin registrar (se puede volver a pulsar); plazo = objetivo + max(5 s, objetivo); puntúa por cercanía al objetivo (como
  Estimación). Modos: visible, a ciegas, desaparece a los N s (tele y móvil); tras pulsar no se enseña el tiempo hasta revelar.
- **Reflejos**: cada fila de la hoja (N rondas) se convierte en N preguntas. Rojo en `tOpen`, verde en `tGreen` = `tOpen`
  + 2–6 s al azar (lo elige el portátil); el móvil cambia a verde con su reloj sincronizado. Pulsar en rojo → eliminado de
  la ronda (cuenta como respondido). Valor = ms de reacción; plazo = verde + 3 s; puntos por puestos. Duelo: el presentador
  fija a los dos con `setDuel` (se mantiene entre rondas).

**Sección Libre** (`src/core/free.js`, `FreeRound`): `setup` (el presentador marca participantes: jugadores o equipos
según la columna Participan) → `running` (cronómetro: "eliminado" guarda el tiempo y al caer el último se para solo;
contador: ±1 por participante) → `stopped` → `awarded` (el mando propone ganador según la herramienta; se puede cambiar
y marcar varios; cada ganador recibe los puntos de la fila; con equipos van al bonus del equipo). Sin herramienta se elige
ganador directamente. Las pruebas puntuadas se guardan en `itemResults` (`{free, byTeams}`) y R las reinicia quitando
los puntos. El móvil del jugador solo informa ("¡Te toca!", "¡Eliminado!", "¡Has ganado!").

Comodines (solo Test, antes de responder): `JokerBank` por dueño (equipo, o jugador sin equipos), 50 % quita
floor(n/2) incorrectas, Doble, Público (ve el recuento en directo). Preguntas reveladas se guardan en `itemResults`
(persistido): al volver a ellas se ven reveladas; R las reinicia quitando sus puntos y devolviendo comodines. Salir de una
pregunta sin revelar devuelve sus comodines.

Teclas de la tele: Espacio (contextual: abrir turno / siguiente pregunta / avanzar; en respuestas: abrir → cerrar →
revelar → siguiente), ← →, P (mostrar pregunta),
V (mostrar respuesta), A (acierto), F (fallo), R (reiniciar pregunta), M (marcador), D (depuración).
Las pulsaciones solo cuentan en una pregunta de pulsador (`HostRoom.inBuzzerPlay`); fuera, `buzzAck closed` sin bloquear.
Cada pregunta del runner (`runner.playKey`) reinicia el motor (`game.next()`).
La tele repinta la pantalla solo si cambia algo visible (firma JSON sin latencias): así las animaciones no se repiten.
Antes de cada repintado se llama a `stop()` de las tres pantallas de juego (`stage`, `answerStage`, `freeStage`): quita
el ganador a pantalla completa, relojes y la luz de Reflejos de la pantalla anterior (si no, quedaban encima al saltar de sección).
Los `<dialog>` se gestionan con el evento `submit` del formulario, no con `close`: Chrome no dispara `close`
mientras la página no se pinta (ventana oculta o minimizada).

- Latido: el presentador manda `hb` cada 2 s; RTT = mediana de los últimos 5. Sin respuesta en 6 s → desconectado.
  El jugador, si no recibe `hb` en 6 s, cierra y reconecta.
- Reconexión del jugador: espera creciente 0,5 s → 5 s, inmediata al volver a primer plano o recuperar red. Si nunca
  llegó a entrar y la sala no existe (`peer-unavailable`), avisa tras unos intentos; si ya había entrado, reintenta siempre.
- Recarga del presentador: estado en localStorage (`concurso.host.v1`, caduca a las 12 h) → "Recuperar sala". Se vuelve
  a registrar el mismo ID; si PeerJS lo tiene ocupado (`unavailable-id`) se reintenta cada 2 s.
- Una vez establecidas, las conexiones son P2P: si cae el servidor PeerJS solo fallan las conexiones nuevas.

### Justicia en los tiempos (fase 3)

- Relojes con `performance.now()` en ambos lados (monótono); la pulsación usa `event.timeStamp` del `pointerdown`
  (instante del toque, no de la ejecución del manejador; si cae a >1 s de `performance.now()` se usa este).
- `src/core/clockSync.js`: NTP iniciado por el móvil. Ráfaga de 10 muestras cada 60 ms al conectar, mini-ráfaga de 4
  cada 15 s y completa al volver a primer plano. Ventana de 24 muestras de ≤ 90 s; se toman las 3 de menor RTT,
  mediana del offset, `err = rttMin/2`. Se reinicia en cada conexión (el presentador pudo recargar: su reloj empieza de 0).
  `player/syncClient.js` lo ejecuta; el presentador contesta `syncReply` en cuanto llega `sync` (t1 = llegada, t2 = salida).
- `src/core/plausibility.js`: `tPress = tLocal + offset`, recortado a `tArrival` si dice ser posterior a la llegada (más de
  max(10 ms, err)) y a `tArrival − max(250 ms, 2×RTT latido)` si dice ser demasiado anterior.
- Apertura programada: el móvil sincronizado cambia a "¡PULSA!" en `tOpen − offset` (a la vez que la tele); sin
  sincronizar, en `recepción + opensInMs`.
- Ventana de 150 ms tras la primera llegada válida; orden por `tPress`, desempate por llegada y `playerId`.
- Modo depuración (D): por jugador RTT del latido, offset, error y muestras; por ronda pulsó / llegó / red / origen.
- Límites y trampas: ver README, "Justicia en los tiempos".

## Diseño del concurso (acordado; hecho hasta la fase 7, salvo que el presentador juegue)

- **Tres papeles:** `host.html` = espectáculo en la tele (sigue siendo la autoridad: estado, puntos, conexiones,
  música); `control.html` = mando del presentador en su móvil (ve preguntas y respuestas en privado, lo controla
  todo); `index.html` = jugador. El mando se empareja con un QR con clave secreta que muestra la tele en
  preparación + confirmación con tecla en el portátil; luego se recuerda. El teclado del portátil sigue de respaldo.
- **El presentador también puede jugar** en las secciones que lo permitan (columna "El presentador juega").
- **Pantallas de la tele:** Preparación → Portada → [Intro de sección → rondas → Marcador] × N → Final (podios).
- **Equipos:** se eligen al entrar; antes de empezar, pantalla de comprobación y "Equipos cerrados" (solo el
  presentador puede mover a alguien después). Puntos individuales visibles; equipo = suma de sus miembros + puntos
  dados al equipo entero.
- **Contenido:** hoja de cálculo `.xlsx` (plantilla con una pestaña por tipo de sección + Concurso, Equipos,
  Ajustes, Instrucciones), importada en el portátil con validación por fila.
- **Música:** sin Spotify (descartado): la pone el presentador aparte. Las columnas "Música de entrada", "Canción" y
  "Desde segundo" ya no están en la plantilla; si una hoja antigua las trae, se leen pero no se usan.
- **Secciones:**
  - **Pulsador** (la actual) + la pregunta en grande en la tele cuando el presentador quiera.
  - **Test** (4 respuestas): solo puntúa acertar; respuesta definitiva; comodines 50 %, Doble y Público.
  - **Verdad o mentira**: V/F a la vez; variante "Dos verdades y una mentira" sobre un jugador (él no vota).
  - **¿Quién es más probable que…?**: todos votan a un jugador; revelado con suspense; puntos a quien vota con la mayoría.
  - **Estimación**: cada uno escribe un número; más cercano, o "sin pasarse" (El precio justo) según la pregunta.
  - **Parar el contador**: objetivo en segundos; modo visible / a ciegas / desaparece a los N s, elegible por ronda.
  - **Duelo de reflejos**: rojo → verde tras 2–6 s al azar; pulsar en rojo elimina de la ronda; todos o un duelo.
  - **Libre** (p. ej. "Fit o Fat"): participantes y puntos; herramientas cronómetro (con "eliminado") y contador +1/−1.

## Fases

1. Conexión, sala, QR, lista de jugadores, reconexión, persistencia. ✔
2. Flujo del pulsador (orden por llegada). ✔
3. Sincronización de tiempos y modo depuración. ✔
4. Base del concurso: roles tele / mando / jugador, estructura por secciones y pantallas, equipos con
   comprobación, importación de la hoja + plantilla, Pulsador como sección. ✔
   (Los demás tipos ya se leen y validan desde la hoja; en el juego muestran su intro y se saltan hasta su fase.)
5. Respuestas desde el móvil: Test (con comodines), Verdad o mentira, Dos verdades, ¿Quién es más probable…?, Estimación. ✔
6. Secciones de tiempo: Parar el contador y Duelo de reflejos. ✔
7. Sección Libre (cronómetro y contador). ✔ Pendiente de esta fase: que el presentador juegue desde el mando.
8. ~~Spotify~~ — descartado: la música la pone el presentador aparte.
9. Espectáculo: transiciones, marcador animado, podios, sonidos, wake lock, tarjetas compactas para 20 jugadores.

Hoja de ruta posterior: mandos físicos (Gamepad API), imagen pixelada, agitar el móvil, rosco, dibuja y adivina.
