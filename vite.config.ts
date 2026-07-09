import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // GitHub Pages serves the site from /VisionApp/; Capacitor and local dev use /.
  base: process.env.GHPAGES ? '/VisionApp/' : '/',
  plugins: [
    react(),
    tailwindcss(),
    // getUserMedia requires a secure context: plain http only works on localhost.
    // `npm run dev:lan` serves self-signed https so a phone on the same network can use the camera.
    ...(mode === 'lan' ? [basicSsl()] : []),
  ],
  resolve: {
    alias: {
      // Only the MoveNet runtime is used; the BlazePose-MediaPipe import breaks bundling.
      '@mediapipe/pose': fileURLToPath(new URL('./src/shims/mediapipe-pose-stub.ts', import.meta.url)),
    },
  },
  server: {
    host: true,
    // Preview tooling assigns a free port via PORT; default stays 5173.
    port: Number(process.env.PORT) || 5173,
  },
}))
