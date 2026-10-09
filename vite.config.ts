import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages under /<repo>/ and locally.
// Routing uses the URL hash, so no server-side rewrites are needed.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
