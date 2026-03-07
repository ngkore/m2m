import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

const isDev = process.env.NODE_ENV !== 'production';

export default defineConfig({
  plugins: isDev ? [basicSsl()] : [],
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
