import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Pulse — static, installable, zero runtime CDN dependencies.
 *
 * `VITE_BASE` lets one codebase deploy to both a domain root (Vercel, Netlify,
 * a custom domain) and a project subpath (GitHub Pages, e.g. /Patientgpt/).
 * Everything else — the manifest, the service worker, the router — is written
 * relative to it, so a subpath deploy is not a special case.
 */

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://script.google.com https://script.googleusercontent.com",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/**
 * Static hosts that cannot set response headers (GitHub Pages) would otherwise
 * lose the CSP. Inject it as a meta tag at build time. `frame-ancestors` is not
 * valid in a meta tag, which is why Vercel/Netlify keep the header version too.
 */
function cspMeta(): Plugin {
  return {
    name: 'pulse-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '</head>',
        `  <meta http-equiv="Content-Security-Policy" content="${CSP}" />\n  </head>`,
      );
    },
  };
}

/**
 * GitHub Pages serves 404.html for unknown paths, and unlike Vercel/Netlify it
 * cannot rewrite. A copy of the built shell keeps deep links working.
 */
function pages404(): Plugin {
  let outDir = 'dist';
  return {
    name: 'pulse-pages-404',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const source = readFileSync(join(outDir, 'index.html'), 'utf8');
      writeFileSync(join(outDir, '404.html'), source);
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react(), tailwindcss(), cspMeta(), pages404()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // Accept the proxied preview host used by the sandbox.
    allowedHosts: true,
    cors: true,
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 700,
  },
});
