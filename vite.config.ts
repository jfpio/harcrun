import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'harcrun-offline-build',
      closeBundle() {
        const version = createHash('sha256')
          .update(readFileSync('dist/index.html'))
          .digest('hex')
          .slice(0, 16);
        const assets = readdirSync('dist/assets').map((name) => `/assets/${name}`);
        const source = readFileSync('public/sw.js', 'utf8');
        if (!source.includes('const PRECACHE = [];'))
          throw new Error('Missing offline precache placeholder.');
        writeFileSync(
          'dist/sw.js',
          source
            .replace("'harcrun-shell-v1'", JSON.stringify(`harcrun-shell-${version}`))
            .replace('const PRECACHE = [];', `const PRECACHE = ${JSON.stringify(assets)};`),
        );
      },
    },
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/@zxing/')) return 'scanner';
          if (id.includes('/firebase/') || id.includes('/@firebase/')) return 'firebase';
          if (id.includes('/node_modules/')) return 'vendor';
        },
      },
    },
  },
});
