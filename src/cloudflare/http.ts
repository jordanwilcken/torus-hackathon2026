import type { GridFeeds, GridSnapshotStores } from '../server/gridFeeds.ts';
import type { LocalRuns } from '../server/jobs/localRuns.ts';
import { validateLocalRunRequest } from '../server/jobs/request.ts';
import { snapshotRevision } from '../server/snapshotRevision.ts';

export type DemoApi = {
  feeds: GridFeeds;
  stores: GridSnapshotStores;
  jobs: LocalRuns;
  waitUntil(promise: Promise<void>): void;
};
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const revisionPattern = /^[a-f0-9]{64}$/;
const maximumBodyBytes = 256_000;

export function jsonResponse(status: number, value: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

/** Stop forwarding unread uploads before an early response ends its request lifetime. */
export async function discardRequestBody(request: Request): Promise<void> {
  const body = request.body;
  if (!body || body.locked || request.bodyUsed) return;
  await body.cancel().catch(() => {});
}
export class RequestFailure extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** Own at most one bounded upload before forwarding it across Worker request lifetimes. */
export async function boundedRequestBytes(request: Request): Promise<Uint8Array<ArrayBuffer>> {
  const declared = request.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > maximumBodyBytes) {
    throw new RequestFailure(413, 'Run request is too large.');
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maximumBodyBytes) throw new RequestFailure(413, 'Run request is too large.');
      parts.push(part.value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const part of parts) { body.set(part, offset); offset += part.byteLength; }
    return body;
  } catch (error) {
    // A size rejection must not cancel the outer HTTP upload and abort its 413 response.
    if (error instanceof RequestFailure) throw error;
    await reader.cancel().catch(() => {});
    throw new RequestFailure(400, 'The run request could not be read.');
  } finally { reader.releaseLock(); }
}

async function requestBody(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new RequestFailure(415, 'Use application/json.');
  }
  const body = await boundedRequestBytes(request);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
  catch { throw new RequestFailure(400, 'The run request must contain valid UTF-8 JSON.'); }
}
/** HTTP transport only. Provider, admission, execution and storage behavior stay in their shared components. */
export async function handleDemoApi(request: Request, api: DemoApi): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  try {
    const feed = path === '/api/grid/eia' ? 'eia' : path === '/api/grid/caiso' ? 'caiso' : null;
    if (feed) {
      if (request.method !== 'GET') return jsonResponse(405, { error: 'Use GET.' }, { Allow: 'GET' });
      const revisions = url.searchParams.getAll('revision');
      if (revisions.length) {
        if (revisions.length !== 1 || !revisionPattern.test(revisions[0])) return jsonResponse(400, { error: 'A revision must be one lowercase SHA-256 identifier.' });
        const record = await api.stores[feed].read(revisions[0]);
        if (!record) return jsonResponse(404, { error: 'Saved revision not found.' });
        if (record.revision !== revisions[0] || record.revision !== snapshotRevision(record.snapshot)) throw new Error('Stored revision failed verification');
        return jsonResponse(200, { archived: true, revision: record.revision, snapshot: record.snapshot });
      }
      return jsonResponse(200, await api.feeds[feed].read());
    }
    if (path === '/api/jobs/context' && request.method === 'GET') return jsonResponse(200, await api.jobs.context());
    if (path === '/api/jobs/runs' && request.method === 'POST') {
      const origin = request.headers.get('origin');
      // Workers receive the original public URL directly. Never trust forwarded host/protocol headers.
      if (origin !== null && origin !== url.origin) return jsonResponse(403, { error: 'Cross-origin execution is not allowed.' });
      const body = await requestBody(request);
      let input;
      try { input = validateLocalRunRequest(body); }
      catch { return jsonResponse(400, { error: 'Invalid workload, policy, revision, or model assumptions.' }); }
      const run = await api.jobs.submit(input);
      // Submission durably records the decision first; keep actual execution alive after the HTTP receipt returns.
      api.waitUntil(api.jobs.waitForIdle());
      return jsonResponse(202, run);
    }
    const match = /^\/api\/jobs\/runs\/([^/]+)(\/output)?$/.exec(path);
    if (match && idPattern.test(match[1]) && request.method === 'GET') {
      const run = await api.jobs.read(match[1]);
      if (!run) return jsonResponse(404, { error: 'Run not found.' });
      if (match[2]) {
        if (!run.execution.output) return jsonResponse(404, { error: 'This run has no successful output.' });
        return new Response(run.execution.output.text, { headers: {
          'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Output-SHA256': run.execution.output.id,
        } });
      }
      return jsonResponse(200, run);
    }
    return jsonResponse(404, { error: 'API route not found.' });
  } catch (error) {
    if (error instanceof RequestFailure) return jsonResponse(error.status, { error: error.message });
    return jsonResponse(503, { error: 'The data or run could not be read or durably recorded. No new success is claimed.' });
  } finally { await discardRequestBody(request); }
}
