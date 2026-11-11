import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Which vendor file a package goes in. Named one by one on purpose: the old
// list form let Rollup pull recharts' own helpers into the charts file —
// clsx among them — and the shell uses clsx, so every first open (the sign-in
// page, a rep's home) downloaded the whole chart library for one small helper.
// clsx now sits with React, which every page loads anyway.
const VENDOR_CHUNKS = {
  'react-vendor': ['react', 'react-dom', 'react-router', 'react-router-dom', '@remix-run/router', 'scheduler', 'clsx'],
  query: ['@tanstack/query-core', '@tanstack/react-query'],
  charts: ['recharts', 'recharts-scale', 'react-smooth', 'victory-vendor', 'decimal.js-light', 'lodash', 'eventemitter3',
    'fast-equals', 'tiny-invariant', 'react-is', 'prop-types', 'internmap', 'dom-helpers', 'react-transition-group'],
  motion: ['motion', 'framer-motion', 'motion-dom', 'motion-utils'],
  // One file for every icon in use; left alone Rollup makes dozens of tiny ones.
  icons: ['lucide-react'],
};
const PACKAGE_CHUNK = new Map(Object.entries(VENDOR_CHUNKS).flatMap(([chunk, pkgs]) => pkgs.map((p) => [p, chunk])));

function vendorChunk(id) {
  const at = id.lastIndexOf('/node_modules/');
  if (at === -1) return undefined;
  const parts = id.slice(at + '/node_modules/'.length).split('/');
  const pkg = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
  return PACKAGE_CHUNK.get(pkg) ?? (pkg.startsWith('d3-') ? 'charts' : undefined);
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    // Split heavy vendors into their own chunks for faster, cacheable loads.
    rollupOptions: {
      output: {
        manualChunks: vendorChunk,
      },
    },
  },
  server: {
    port: 5173,
    // Proxy /api to the backend in dev so the SPA and API share an origin.
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:4000',
        changeOrigin: true,
      },
      // The public product page is served by Express at the app root, not
      // under /api, so the label editor's preview needs its own proxy in dev.
      // In production vercel.json rewrites /p to the same function.
      // Anchored: a bare '/p' key is a prefix match and would also swallow
      // /pepa/* pictures, which Vite serves itself from client/public.
      // The digit covers the second box's page, /p2, and whatever number a
      // later box takes — the editor previews each box on its own page.
      '^/[pP][0-9]*/?(\\?.*)?$': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  preview: { port: 4173 },
});
