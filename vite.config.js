import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [basicSsl()],
  // Serve everything in images/ as static files at the root URL.
  // images/favicon/* → /favicon/*   images/m2m-logo.png → /m2m-logo.png
  publicDir: 'images',
  server: {
    host: process.env.HOST || 'localhost',
    port: Number(process.env.PORT_CLIENT) || 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.PORT || 3001}`,
        changeOrigin: true,
        timeout: 60000,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
