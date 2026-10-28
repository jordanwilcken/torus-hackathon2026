import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createApplication, type ApplicationOptions } from './application.ts';

export type ProductionServerOptions = {
  application: ApplicationOptions;
  distDirectory: string;
  publicOrigin: string;
  username: string;
  password: string;
  host?: string;
  port?: number;
};

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

function json(response: ServerResponse, status: number, value: unknown) {
  if (response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

export function validatePublicOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('PUBLIC_ORIGIN must be an HTTPS origin.'); }
  const loopbackHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !loopbackHttp) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PUBLIC_ORIGIN must be an HTTPS origin without a path, credentials, query or fragment.');
  }
  return url.origin;
}

function authorized(request: IncomingMessage, expected: Buffer): boolean {
  const supplied = createHash('sha256').update(request.headers.authorization ?? '').digest();
  return timingSafeEqual(supplied, expected);
}

function withinDirectory(directory: string, file: string): boolean {
  const path = relative(directory, file);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function publicFile(directory: string, pathname: string) {
  const filename = resolve(directory, `.${pathname}`);
  if (!withinDirectory(directory, filename)) return null;
  try {
    const actual = await realpath(filename);
    if (!withinDirectory(directory, actual)) return null;
    const information = await stat(actual);
    return information.isFile() ? { filename: actual, size: information.size } : null;
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return null;
    throw error;
  }
}

async function serveStatic(request: IncomingMessage, response: ServerResponse, directory: string, pathname: string) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return;
  }
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { json(response, 400, { error: 'Invalid path.' }); return; }
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(segment => segment.startsWith('.'))) {
    json(response, 404, { error: 'File not found.' }); return;
  }
  let path = decoded === '/' ? '/index.html' : decoded;
  let extension = extname(path);
  let file = contentTypes[extension] ? await publicFile(directory, path) : null;
  // Only document navigation gets the SPA shell. Missing assets and API routes remain errors.
  if (!file && !extension && request.headers.accept?.includes('text/html')) {
    path = '/index.html'; extension = '.html'; file = await publicFile(directory, path);
  }
  if (!file) { json(response, 404, { error: 'File not found.' }); return; }
  response.writeHead(200, {
    'Content-Type': contentTypes[extension], 'Content-Length': file.size,
    'Cache-Control': extension === '.html' ? 'no-store' : 'private, max-age=3600',
  });
  if (request.method === 'HEAD') { response.end(); return; }
  await pipeline(createReadStream(file.filename), response);
}

/** One process owns one job database. TLS is terminated by the configured reverse proxy. */
export async function startProductionServer(options: ProductionServerOptions) {
  const origin = validatePublicOrigin(options.publicOrigin);
  if (!options.username || options.username.includes(':') || /[\r\n]/.test(options.username)
    || !options.password || options.password.length < 16 || /[\r\n]/.test(options.password)) {
    throw new Error('DEMO_USERNAME and a DEMO_PASSWORD of at least 16 characters are required.');
  }
  const directory = await realpath(resolve(options.distDirectory));
  if (!await publicFile(directory, '/index.html')) throw new Error('Build the UI before starting the production server.');
  const expectedAuthorization = createHash('sha256').update(`Basic ${Buffer.from(`${options.username}:${options.password}`).toString('base64')}`).digest();
  const application = await createApplication({ ...options.application, publicOrigin: origin });
  let closing: Promise<void> | undefined;
  let stopping = false;
  const server = createServer({ requestTimeout: 30_000, headersTimeout: 10_000, keepAliveTimeout: 5_000, maxHeaderSize: 16_384 }, (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    let pathname: string;
    try { pathname = new URL(request.url ?? '/', 'http://localhost').pathname; }
    catch { json(response, 400, { error: 'Invalid URL.' }); return; }
    if (pathname === '/healthz' && (request.method === 'GET' || request.method === 'HEAD')) {
      json(response, stopping ? 503 : 200, { status: stopping ? 'stopping' : 'ok' }); return;
    }
    if (!authorized(request, expectedAuthorization)) {
      response.setHeader('WWW-Authenticate', 'Basic realm="Sunchaser demo", charset="UTF-8"');
      json(response, 401, { error: 'Demo sign-in required.' }); return;
    }
    if (stopping) { json(response, 503, { error: 'Server is stopping.' }); return; }
    try {
      application.handle(request, response, () => {
        if (pathname === '/api' || pathname.startsWith('/api/')) { json(response, 404, { error: 'API route not found.' }); return; }
        void serveStatic(request, response, directory, pathname).catch(() => {
          if (response.headersSent) response.destroy(); else json(response, 500, { error: 'File could not be served.' });
        });
      });
    } catch { json(response, 503, { error: 'Application unavailable.' }); }
  });
  server.maxRequestsPerSocket = 100;
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  try {
    await new Promise<void>((done, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? 3000, options.host ?? '127.0.0.1', () => { server.off('error', reject); done(); });
    });
  } catch (error) { await application.close(); throw error; }
  const address = server.address();
  return {
    server,
    port: typeof address === 'object' && address ? address.port : options.port,
    close() {
      return closing ??= (async () => {
        stopping = true;
        const drained = new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
        const timeout = setTimeout(() => server.closeAllConnections(), 10_000);
        timeout.unref();
        try { await drained; } finally { clearTimeout(timeout); await application.close(); }
      })();
    },
  };
}
