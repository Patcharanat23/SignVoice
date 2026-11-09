import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Three pages: the app (speak + teach), the login/register page and the admin page.
export default defineConfig({
  build: {
    rollupOptions: {
      input: { main: resolve('index.html'), login: resolve('login.html'), admin: resolve('admin.html') }
    }
  }
});
