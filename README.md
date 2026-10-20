# Concurso del año

Pulsador de concurso con móviles, estilo Kahoot. La pantalla del presentador se ve en la tele (portátil
conectado por HDMI); cada jugador usa su móvil como pulsador, sin instalar nada. Web 100 % estática
(GitHub Pages) con WebRTC mediante [PeerJS](https://peerjs.com/).

> Estado: **fase 1** — sala, QR, lista de jugadores, marcador manual y reconexión. El flujo de preguntas llega en la fase 2.

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

Para probar sin móvil: abre `host.html` en una pestaña y la dirección del QR en otra (o en otro navegador para
tener otro jugador distinto; dos pestañas del mismo navegador comparten jugador porque comparten localStorage).
Si solo vas a usar el portátil, `npm run dev:http` arranca sin certificado en `http://localhost:5174/host.html`.

### Tests

```bash
npm test
```

Cubren la lógica que no depende de la red (`src/core`, `src/shared`).

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
