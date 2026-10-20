# Concurso del año

Pulsador de concurso con móviles, estilo Kahoot. La pantalla del presentador se ve en la tele (portátil
conectado por HDMI); cada jugador usa su móvil como pulsador, sin instalar nada. Web 100 % estática
(GitHub Pages) con WebRTC mediante [PeerJS](https://peerjs.com/).

> Estado: **fase 2** — sala, QR, jugadores, reconexión y flujo completo del pulsador (gana quien llega antes).
> La sincronización de relojes (gana quien pulsó antes de verdad) llega en la fase 3.

## Cómo se juega

1. Abre `host.html` en el portátil conectado a la tele y pon la ventana a pantalla completa.
2. Los jugadores escanean el QR y eligen nombre, color e icono (mínimo 2, máximo 20).
3. Lee la pregunta en voz alta y pulsa **Espacio** («Abrir turno»). A los 300 ms la tele y los móviles pasan a
   **¡Pulsad!** a la vez.
4. La primera pulsación llena la tele con el color y el nombre del ganador, su tiempo y el orden de los siguientes
   (con «casi empate» si la diferencia es menor de 30 ms).
5. Decide:
   - **A** — Acierto: suma los puntos al ganador.
   - **F** — Fallo: bloquea a quien falló y reabre el turno para los demás (tienen que volver a pulsar).
   - **Espacio** — Siguiente pregunta.
   - **R** — Reiniciar la pregunta (también quita los bloqueos).
6. Quien pulse antes de abrir el turno queda **bloqueado** en esa pregunta (se puede desactivar en **Ajustes** o
   perdonar con «Desbloquear» en su tarjeta).

En **Ajustes** se cambian los puntos por acierto y por fallo (negativos para restar), el umbral de casi empate,
la ventana de decisión y la apertura programada. Los botones +/− de cada tarjeta corrigen el marcador a mano.

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
