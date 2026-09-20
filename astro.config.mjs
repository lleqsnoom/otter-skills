import node from '@astrojs/node';
import solid from '@astrojs/solid-js';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

/**
 * The server renders one shell and answers `/api/*` from the filesystem beside it; the Solid island does the
 * routing. Vite is also where Tailwind is wired in, pointed at this app's own tokens (see `src/tailwind.css`).
 */
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { host: '127.0.0.1', port: Number(process.env.PORT || 4321) },
  integrations: [solid()],
  vite: {
    plugins: [tailwindcss()],
    // Mermaid is only reached through a dynamic `import()` when a document actually carries a diagram, which is
    // exactly the case the dev server cannot anticipate: without this it is discovered mid-session, and the first
    // dynamic import fails while the optimizer catches up ("Failed to fetch dynamically imported module"). Listed
    // here it is pre-bundled once at startup instead.
    optimizeDeps: { include: ['mermaid'] },
  },
});