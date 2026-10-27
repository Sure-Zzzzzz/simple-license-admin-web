import http from 'node:http';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import qiankun from 'vite-plugin-qiankun';

export default defineConfig({
  base: '/app/license/',
  plugins: [vue(), qiankun('license', { useDevMode: true })],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8181', agent: new http.Agent({ keepAlive: false }) },
      '/oauth2': { target: 'http://localhost:8180', agent: new http.Agent({ keepAlive: false }) }
    }
  }
});
