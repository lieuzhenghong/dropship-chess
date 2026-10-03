import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build also works from file:// or a native
  // WebView (Capacitor/Cordova) and from any sub-path on a static host.
  base: './',
  build: { target: 'es2020' },
});
