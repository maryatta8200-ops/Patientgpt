/**
 * PWA deployment contract.
 *
 * The app must install correctly both at a domain root (Vercel/Netlify) and
 * under a subpath (GitHub Pages project sites). That only holds while every
 * path stays base-relative, so these tests assert the source of truth rather
 * than a build artefact that might be stale.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

let manifest: Record<string, unknown>;
let sw: string;
let html: string;
let register: string;
let viteConfig: string;

beforeAll(() => {
  manifest = JSON.parse(read('public/manifest.webmanifest'));
  sw = read('public/sw.js');
  html = read('index.html');
  register = read('src/lib/sw-register.ts');
  viteConfig = read('vite.config.ts');
});

describe('manifest', () => {
  it('is installable', () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBeTruthy();
  });

  it('uses relative start_url and scope, so a subpath deploy works', () => {
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.id).toBe('./');
  });

  it('references no root-absolute paths', () => {
    const json = JSON.stringify(manifest);
    expect(json).not.toMatch(/"\/[a-z]/i);
  });

  it('ships both purpose:any and purpose:maskable icons at 192 and 512', () => {
    const icons = manifest.icons as Array<{ src: string; sizes: string; purpose?: string }>;
    const has = (size: string, purpose: string) =>
      icons.some((i) => i.sizes === size && (i.purpose ?? 'any') === purpose);

    expect(has('192x192', 'any')).toBe(true);
    expect(has('512x512', 'any')).toBe(true);
    expect(has('192x192', 'maskable')).toBe(true);
    expect(has('512x512', 'maskable')).toBe(true);
  });

  it('includes theme and background colours so the splash is not white', () => {
    expect(manifest.theme_color).toBe('#05070a');
    expect(manifest.background_color).toBe('#05070a');
  });
});

describe('index.html', () => {
  it('links the manifest through the build base', () => {
    expect(html).toContain('href="%BASE_URL%manifest.webmanifest"');
  });

  it('has no hardcoded root-absolute asset links', () => {
    // Vite rewrites %BASE_URL% at build time; a literal "/icons" would break Pages.
    expect(html).not.toMatch(/(href|content)="\/(icons|manifest)/);
  });

  it('declares the theme colour and apple meta tags', () => {
    expect(html).toContain('name="theme-color"');
    expect(html).toContain('name="apple-mobile-web-app-capable"');
    expect(html).toContain('href="%BASE_URL%icons/apple-touch-icon.png"');
  });
});

describe('service worker', () => {
  it('derives its paths from the registration scope, not the domain root', () => {
    expect(sw).toContain('self.registration');
    expect(sw).toContain('const at =');
    // No absolute shell entries left behind.
    expect(sw).not.toMatch(/^\s*'\/index\.html',/m);
    expect(sw).not.toMatch(/^\s*'\/icons\//m);
  });

  it('never caches relay traffic', () => {
    expect(sw).toContain('googleusercontent.com');
    const fetchBlock = sw.slice(sw.indexOf("addEventListener('fetch'"));
    const guard = fetchBlock.slice(0, fetchBlock.indexOf('respondWith'));
    expect(guard).toContain('google.com');
  });

  it('falls back to a cached shell when offline', () => {
    expect(sw).toContain("at('index.html')");
    expect(sw).toMatch(/offline/i);
  });

  it('cleans up caches from previous versions', () => {
    expect(sw).toContain('caches.delete');
  });
});

describe('registration', () => {
  it('registers from the deploy base so the scope matches the files', () => {
    expect(register).toContain('import.meta.env.BASE_URL');
    expect(register).not.toMatch(/register\('\/sw\.js'/);
  });
});

describe('build configuration', () => {
  it('honours VITE_BASE so one codebase serves root and subpath deploys', () => {
    expect(viteConfig).toContain('VITE_BASE');
    expect(viteConfig).toContain("base: process.env.VITE_BASE || '/'");
  });

  it('injects a CSP that allows the relay and nothing else', () => {
    expect(viteConfig).toContain('Content-Security-Policy');
    expect(viteConfig).toContain('https://script.google.com');
    expect(viteConfig).toContain("default-src 'self'");
    // Google must not be permitted to run script.
    expect(viteConfig).toMatch(/script-src 'self'/);
  });
});
