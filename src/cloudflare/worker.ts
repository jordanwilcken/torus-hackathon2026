import { createHash, timingSafeEqual } from 'node:crypto';
import { createDemoRuntime } from './runtime.ts';
import type { SqliteStorage } from './storage.types.ts';
import { boundedRequestBytes, jsonResponse, RequestFailure } from './http.ts';

type ObjectId = { toString(): string };
export type WorkerEnvironment = {
  EIA_API_KEY: string;
  DEMO_USERNAME: string;
  DEMO_PASSWORD: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
  DEMO: { idFromName(name: string): ObjectId; get(id: ObjectId): { fetch(request: Request): Promise<Response> } };
};
type ObjectContext = { storage: SqliteStorage; waitUntil(promise: Promise<void>): void };

/** One SQLite-backed durable object serializes admission and owns actual bounded CPU work. */
export class Demo {
  private readonly runtime: ReturnType<typeof createDemoRuntime>;
  constructor(ctx: ObjectContext, env: WorkerEnvironment) {
    this.runtime = createDemoRuntime(ctx.storage, { apiKey: env.EIA_API_KEY, waitUntil: promise => ctx.waitUntil(promise) });
  }
  fetch(request: Request): Promise<Response> { return this.runtime.fetch(request); }
}

function configured(env: WorkerEnvironment): boolean {
  return !!env.EIA_API_KEY?.trim() && !!env.DEMO_USERNAME && !/[:\r\n]/.test(env.DEMO_USERNAME)
    && !!env.DEMO_PASSWORD && env.DEMO_PASSWORD.length >= 16 && !/[\r\n]/.test(env.DEMO_PASSWORD);
}
function authenticated(request: Request, env: WorkerEnvironment): boolean {
  const expected = createHash('sha256').update(`Basic ${Buffer.from(`${env.DEMO_USERNAME}:${env.DEMO_PASSWORD}`).toString('base64')}`).digest();
  const supplied = createHash('sha256').update(request.headers.get('authorization') ?? '').digest();
  return timingSafeEqual(expected, supplied);
}
function protectedResponse(response: Response, assets = false): Response {
  const result = new Response(response.body, response);
  result.headers.set('X-Content-Type-Options', 'nosniff');
  result.headers.set('Referrer-Policy', 'no-referrer');
  result.headers.set('X-Frame-Options', 'DENY');
  result.headers.set('Cache-Control', assets ? 'private, max-age=3600' : 'no-store');
  return result;
}

async function routeWorkerRequest(request: Request, env: WorkerEnvironment): Promise<Response> {
  const url = new URL(request.url);
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    url.protocol = 'https:';
    return Response.redirect(url, 308);
  }
  if (!configured(env)) return protectedResponse(jsonResponse(503, { error: 'The live demo is not configured.' }));
  if (url.pathname === '/healthz' && (request.method === 'GET' || request.method === 'HEAD')) {
    return protectedResponse(request.method === 'HEAD' ? new Response(null) : jsonResponse(200, { status: 'ok' }));
  }
  if (!authenticated(request, env)) {
    return protectedResponse(jsonResponse(401, { error: 'Demo sign-in required.' }, { 'WWW-Authenticate': 'Basic realm="Sunchaser demo", charset="UTF-8"' }));
  }
  try {
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const object = env.DEMO.get(env.DEMO.idFromName('demo'));
      // The forwarded body must not lazily read the original request after an early DO response.
      const forwarded = request.body ? new Request(request, { body: await boundedRequestBytes(request) }) : request;
      return protectedResponse(await object.fetch(forwarded));
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return protectedResponse(jsonResponse(405, { error: 'Use GET or HEAD for assets.' }, { Allow: 'GET, HEAD' }));
    }
    return protectedResponse(await env.ASSETS.fetch(request), true);
  } catch (error) {
    if (error instanceof RequestFailure) return protectedResponse(jsonResponse(error.status, { error: error.message }));
    return protectedResponse(jsonResponse(503, { error: 'The hosted demo is temporarily unavailable.' }));
  }
}
// The platform owns incoming HTTP streams. Do not cancel them while sending a rejection:
// workerd's HTTP bridge can abort the response before its error body reaches the client.
export default { fetch: routeWorkerRequest };
