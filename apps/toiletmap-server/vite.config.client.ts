import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  publicDir: false, // Disable public dir to avoid conflicts with outDir
  build: {
    outDir: 'public/admin',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'loos-list': path.resolve(import.meta.dirname, 'src/admin/pages/loos/client/index.client.tsx'),
        'loos-create': path.resolve(import.meta.dirname, 'src/admin/pages/loos/create/client/index.client.tsx'),
        'loos-edit': path.resolve(import.meta.dirname, 'src/admin/pages/loos/edit/client/index.client.tsx'),
        'styles': path.resolve(import.meta.dirname, 'src/admin/styles.ts')
      },
      output: {
        // Use fixed names for easier development, can add hashing later for production
        entryFileNames: '[name].js',
        chunkFileNames: '[name]-[hash].js',
        assetFileNames: '[name].[ext]'
      }
    },
    // Generate source maps for debugging
    sourcemap: true,
    // Optimize for modern browsers
    target: 'es2020',
    minify: 'esbuild'
  },
  esbuild: {
    // CLIENT-SIDE JSX - this is critical!
    jsxImportSource: 'hono/jsx/dom'
  },
  resolve: {
    alias: {
      '@client': path.resolve(import.meta.dirname, 'src/admin/pages/loos/client')
    }
  },
  // Optimize dependencies
  optimizeDeps: {
    include: ['hono/jsx', 'hono/jsx/dom']
  }
});
