import fs from 'node:fs/promises';
import path from 'node:path';
import type { Context } from 'hono';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
};

const NO_CACHE_FILES = new Set(['index.html', 'sw.js', 'registerSW.js', 'manifest.webmanifest']);
const IMMUTABLE = 'public, max-age=31536000, immutable';

/** Cache-Control for a file path relative to the static root (posix separators, no leading slash). */
export function cacheControlFor(rel: string): string {
  const base = rel.split('/').pop() ?? '';
  if (NO_CACHE_FILES.has(base) || /^workbox-.*\.js$/.test(base)) return 'no-cache';
  if (rel.startsWith('assets/')) return IMMUTABLE;
  return 'public, max-age=3600';
}

async function fileResponse(c: Context, root: string, rel: string): Promise<Response | null> {
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  let data: Buffer;
  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile()) return null;
    data = await fs.readFile(abs);
  } catch {
    return null;
  }
  const relPosix = path.relative(root, abs).split(path.sep).join('/');
  const type = MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
  return c.body(new Uint8Array(data), 200, {
    'Content-Type': type,
    'Content-Length': String(data.byteLength),
    'Cache-Control': cacheControlFor(relPosix),
  });
}

/**
 * GET/HEAD handler serving `staticDir`, with SPA fallback to index.html for paths whose last
 * segment has no file extension. Returns null when nothing matched (caller sends 404).
 */
export async function serveStatic(c: Context, staticDir: string): Promise<Response | null> {
  const root = path.resolve(staticDir);
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(c.req.url).pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  // Normalise separators so "..\\" cannot sneak past on Windows; containment is re-checked in fileResponse.
  const segments = pathname.replace(/\\/g, '/').split('/').filter(Boolean);
  if (segments.some((s) => s === '..')) return null;
  const rel = segments.join('/') || 'index.html';

  const direct = await fileResponse(c, root, rel);
  if (direct) return direct;

  const last = segments.at(-1) ?? '';
  if (last.includes('.')) return null; // looks like a file → real 404, never index.html
  return fileResponse(c, root, 'index.html');
}
