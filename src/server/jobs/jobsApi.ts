import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LocalRunRequest } from '../../data/LocalRun.type.ts';
import type { LocalRuns } from './localRuns.ts';
import { validateLocalRunRequest } from './request.ts';
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export function createJobsApi(jobs: LocalRuns, options: { publicOrigin?: string } = {}) {
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    let path: string;
    try { path = new URL(request.url ?? '/', 'http://localhost').pathname; } catch { send(response, 400, { error: 'Invalid request URL.' }); return; }
    if (!path.startsWith('/api/jobs/')) { next(); return; }
    void (async () => {
      if (path === '/api/jobs/context' && request.method === 'GET') { send(response, 200, await jobs.context()); return; }
      if (path === '/api/jobs/runs' && request.method === 'POST') {
        if (request.headers.origin) {
          const scheme = 'encrypted' in request.socket && request.socket.encrypted ? 'https' : 'http';
          try {
            const allowedOrigin = options.publicOrigin ?? `${scheme}://${request.headers.host}`;
            if (new URL(request.headers.origin).origin !== new URL(allowedOrigin).origin) throw new Error('Origin mismatch');
          } catch { send(response, 403, { error: 'Cross-origin execution is not allowed.' }); return; }
        }
        if (!request.headers['content-type']?.startsWith('application/json')) { send(response, 415, { error: 'Use application/json.' }); return; }
        let text = '';
        for await (const part of request) { text += part.toString(); if (Buffer.byteLength(text) > 256_000) { send(response, 413, { error: 'Run request is too large.' }); return; } }
        let input: LocalRunRequest;
        try { input = validateLocalRunRequest(JSON.parse(text)); } catch { send(response, 400, { error: 'Invalid workload, policy, revision, or model assumptions.' }); return; }
        send(response, 202, await jobs.submit(input)); return;
      }
      const match = /^\/api\/jobs\/runs\/([^/]+)(\/output)?$/.exec(path);
      if (match && idPattern.test(match[1]) && request.method === 'GET') {
        const run = await jobs.read(match[1]);
        if (!run) { send(response, 404, { error: 'Run not found.' }); return; }
        if (match[2]) {
          if (!run.execution.output) { send(response, 404, { error: 'This run has no successful output.' }); return; }
          response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Output-SHA256': run.execution.output.id });
          response.end(run.execution.output.text); return;
        }
        send(response, 200, run); return;
      }
      send(response, 404, { error: 'Job route not found.' });
    })().catch(() => send(response, 503, { error: 'The run could not be read or durably recorded. No new success is claimed.' }));
  };
}
function send(response: ServerResponse, status: number, value: unknown) {
  if (response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
