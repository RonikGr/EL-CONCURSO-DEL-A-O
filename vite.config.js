import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'node:path';

const root = import.meta.dirname;

export default defineConfig(({ mode }) => ({
  // Rutas relativas: funciona en https://usuario.github.io/<cualquier-repo>/ sin configurar nada.
  base: './',
  // Certificado autofirmado para `npm run dev` y `npm run preview`: el móvil necesita HTTPS
  // (Wake Lock, crypto.randomUUID) y no puede usar "localhost".
  // `--mode http` lo quita, solo para probar en el propio portátil (localhost ya es contexto seguro).
  plugins: mode === 'http' ? [] : [basicSsl()],
  build: {
    rollupOptions: {
      input: {
        player: resolve(root, 'index.html'),
        host: resolve(root, 'host.html'),
        control: resolve(root, 'control.html'),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.js'],
  },
}));
