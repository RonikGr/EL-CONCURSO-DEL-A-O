# Concurso del año — pulsador con móviles

Web 100 % estática (GitHub Pages) para concursos en casa. El presentador (portátil conectado a la tele)
crea una sala; cada jugador usa su móvil como pulsador. Comunicación WebRTC con PeerJS usando el
servidor de enlace público (`0.peerjs.com`). **El presentador es la autoridad**: decide ganador, puntos y estado.

## Comandos

- `npm run dev` — servidor Vite con HTTPS autofirmado, accesible desde la LAN (`--host`).
- `npm test` — tests (Vitest) de la lógica pura en `src/core` y `src/shared`.
- `npm run build` — genera `dist/`. El despliegue lo hace `.github/workflows/deploy.yml` al hacer push a `main`.

En este Windows, Node y Git se instalaron con winget; si una terminal antigua no los encuentra, refrescar `PATH`.
Ojo con PowerShell 5.1: `Get-Content`/`Set-Content` sin `-Encoding` rompen los acentos (leen ANSI, escriben BOM). Editar con las herramientas de archivo.
`npm run dev:http` (puerto 5174, sin certificado) sirve para probar en el navegador del portátil.

## Decisiones

- **Vite + Vitest**, sin frameworks. JS plano con módulos ES. Dependencias con versión exacta (`.npmrc` → `save-exact`), lockfile versionado, `npm ci` en CI.
- `base: './'` → funciona bajo cualquier nombre de repositorio en Pages.
- Páginas: `index.html` = jugador (URL corta para teclear), `host.html` = presentador.
- Idioma: identificadores en inglés; comentarios, documentación e interfaz en español.
- Código de sala: 4 caracteres del alfabeto `ACDEFGHJKMNPRTUVWXY23479` (de cada pareja confusa queda como mucho uno: sin O/0/Q, I/1/L, S/5, B/8, 6, Z).
- ID PeerJS del presentador: `concurso-del-ano-v1-<CÓDIGO>` (prefijo porque el servidor público es compartido). Los jugadores usan IDs aleatorios.
- Jugadores: mínimo 2 para jugar, máximo 20. Identidad = `playerId` (UUID en localStorage del móvil), no el nombre.
  - Nombre repetido → el presentador lo renombra a "Ana (2)".
  - Cada jugador elige **color + icono**; la **pareja** color+icono es única en la sala. Si choca, el presentador asigna otra libre y avisa.
  - Los iconos son provisionales (emoji) hasta que el usuario pase su lista: se cambian en `src/shared/appearance.js`.
- Puntos: el presentador decide. "Acierto" suma (configurable) y "Fallo" no toca puntos por defecto; además hay +/− manual.
- Pulsar antes de abrir el turno bloquea al jugador durante esa pregunta (opción activada por defecto).
- Todos los jugadores estarán en la misma wifi (no se optimiza para datos móviles / TURN).
- Sin vibración en iPhone (Safari no la soporta): aceptado.

## Arquitectura

- `src/core/` — lógica pura, sin DOM ni red, con tests: roster de jugadores, (fase 2) máquina de estados de la pregunta y ranking, (fase 3) sincronización de reloj.
- `src/shared/` — protocolo, código de sala, configuración PeerJS, apariencias, almacenamiento seguro.
- `src/host/` — red del presentador, persistencia, interfaz para la tele. Las pulsaciones entran por "fuentes" (`sources/`): hoy móviles; fase 2 de la hoja de ruta: mandos (Gamepad API) con offset 0.
- `src/player/` — red del jugador con reconexión, interfaz del botón, wake lock y vibración.

### Protocolo (JSON por DataConnection fiable, campo `t` = tipo)

Jugador → presentador: `hello {v, playerId, name, color, icon}`, `profile {name, color, icon}`, `hbAck {h0}`,
`buzz {seq, epoch}` (fase 3 añadirá `tLocal, offset, err`), (fase 3) `sync {id, t0}`, `syncReport {offset, rtt, err}`.

Presentador → jugador: `welcome {you, adjusted}`, `state {room, playerCount, minPlayers, taken, you, game, winner}`
(foto completa y personalizada en cada cambio, para que reconectar sea trivial; `game` = `playerView()`),
`hb {h0}` cada 2 s, `buzzAck {seq, result}`, `error {code, message}` (`room-full`, `version`, `removed`, `replaced`),
(fase 3) `syncReply {id, t0, t1, t2}`.

- Mismo `playerId` desde otra conexión (otra pestaña): la vieja recibe `replaced` y deja de reconectar; si no, se echarían mutuamente.
- `?perfil=X` en la página del jugador usa otra identidad (clave de localStorage distinta): para probar varios jugadores en un navegador.

### Motor de preguntas (`src/core/game.js`)

Fases `idle` ("Pregunta en el aire") → `open` (apertura programada en `tOpen`) → `result` (ganador; `judged` = correct) o,
tras "Fallo" sin nadie más, `closed`. "Fallo" bloquea al ganador y abre una ronda nueva para el resto (todos vuelven a pulsar).
`epoch` crece con cada apertura, reinicio (R) y pregunta nueva; el móvil manda la época que veía al pulsar. Una pulsación
de época vieja se descarta (`stale`, sin bloquear) salvo que caiga dentro del turno abierto ahora (`tPress ≥ tOpen`).
El móvil envía también en "Espera": decide el presentador (antes de tiempo → bloqueo si la opción está activa).
Fase 2: `tPress = tArrival` (orden de llegada); la fase 3 solo cambia cómo se calcula `tPress` en `peerSource.js`.
Teclas de la tele: Espacio (abrir / siguiente), A (acierto), F (fallo), R (reiniciar pregunta).

- Latido: el presentador manda `hb` cada 2 s; RTT = mediana de los últimos 5. Sin respuesta en 6 s → desconectado.
  El jugador, si no recibe `hb` en 6 s, cierra y reconecta.
- Reconexión del jugador: espera creciente 0,5 s → 5 s, inmediata al volver a primer plano o recuperar red. Si nunca
  llegó a entrar y la sala no existe (`peer-unavailable`), avisa tras unos intentos; si ya había entrado, reintenta siempre.
- Recarga del presentador: estado en localStorage (`concurso.host.v1`, caduca a las 12 h) → "Recuperar sala". Se vuelve
  a registrar el mismo ID; si PeerJS lo tiene ocupado (`unavailable-id`) se reintenta cada 2 s.
- Una vez establecidas, las conexiones son P2P: si cae el servidor PeerJS solo fallan las conexiones nuevas.

### Justicia en los tiempos (fase 3)

Relojes con `performance.now()` en ambos lados; la pulsación usa `event.timeStamp` del `pointerdown`.
Sincronización NTP iniciada por el móvil: ráfaga de 10 muestras, se toman las 3 de menor RTT, mediana del offset,
error ±rttMin/2; mini-ráfagas cada 15 s y ráfaga completa al reconectar o volver a primer plano.
Apertura programada (`T_open = ahora + 300 ms`) para que tele y móviles cambien a la vez. Los móviles envían siempre
la pulsación; el presentador decide con `tHost` frente a `T_open`. Ventana de 150 ms tras la primera llegada válida;
orden por `tHost`, desempate por llegada y `playerId`; "casi empate" < 30 ms. Las marcas implausibles se recortan.

## Fases

1. Conexión, sala, QR, lista de jugadores, reconexión, persistencia. ✔
2. Flujo del pulsador (orden por llegada). ✔
3. Sincronización de tiempos y modo depuración.
4. Pulido visual, sonido, vibración, wake lock.

Hoja de ruta posterior: mandos físicos (Gamepad API) y archivo de preguntas.
