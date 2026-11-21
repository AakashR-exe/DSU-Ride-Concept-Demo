// Zero-dependency static file server for local development and same-Wi-Fi demos.
//   npm start                 → http://localhost:8000/
//   npm run start:lan         → also reachable from phones on the same Wi-Fi
//   node scripts/serve.mjs --port 9000
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

async function handle(req, res, root) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  let file = path.join(root, pathname);
  if (file !== root && !file.startsWith(root.endsWith(path.sep) ? root : root + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    if ((await fs.stat(file)).isDirectory()) {
      if (!pathname.endsWith('/')) {
        res.writeHead(301, { Location: `${req.url.split('?')[0]}/` }).end();
        return;
      }
      file = path.join(file, 'index.html');
    }
    const body = await fs.readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}

/** Start the server. Port 0 picks a free port; read it from server.address().port. */
export function startServer({ port = 8000, host = '127.0.0.1', root = ROOT } = {}) {
  const resolvedRoot = path.resolve(root);
  const server = http.createServer((req, res) => {
    handle(req, res, resolvedRoot).catch(() => res.writeHead(500).end());
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
  };
  const port = Number(option('port', process.env.PORT ?? 8000));
  const host = option('host', '127.0.0.1');
  try {
    await startServer({ port, host });
  } catch (error) {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is busy. Try: npm start -- --port ${port + 1}` : error.message);
    process.exit(1);
  }
  console.log(`DSU Ride is running at http://localhost:${port}/`);
  if (host === '0.0.0.0') {
    for (const net of Object.values(os.networkInterfaces()).flat()) {
      if (net?.family === 'IPv4' && !net.internal) console.log(`  Same Wi-Fi: http://${net.address}:${port}/`);
    }
    console.log('  (Install, offline mode and GPS need HTTPS, so use the live link for those on phones.)');
  }
  console.log('Press Ctrl+C to stop.');
}
