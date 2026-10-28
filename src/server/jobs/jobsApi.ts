import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LocalRunRequest } from '../../data/LocalRun.type.ts';
import type { LocalRuns } from './localRuns.ts';
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const revisionPattern = /^[a-f0-9]{64}$/;
function requestValue(value: unknown): LocalRunRequest {
  const input = value as LocalRunRequest;
  if (!input || !idPattern.test(input.requestId) || !input.workload || !input.inputRevisions
    || !revisionPattern.test(input.inputRevisions.eia) || !revisionPattern.test(input.inputRevisions.caiso)) throw new Error('Invalid run request');
  const kind = input.workload.kind;
  if (kind !== 'integer-sum' && kind !== 'grid-summary') throw new Error('Unsupported workload');
  if (kind === 'integer-sum' && (!Array.isArray(input.workload.values) || input.workload.values.length > 10_000
    || !input.workload.values.every(Number.isSafeInteger))) throw new Error('Integer values must be safe integers (at most 10,000)');
  const policy = input.policy;
  if (!policy || !Number.isFinite(policy.maximumDemandMW) || policy.maximumDemandMW < 0
    || !Number.isFinite(policy.maximumWholesaleUsdPerMWh) || !policy.maximumAgeMinutes
    || !Object.values(policy.maximumAgeMinutes).every(value => Number.isFinite(value) && value > 0 && value <= 1440)
    || !Number.isFinite(policy.maximumAgeMinutes.eia) || !Number.isFinite(policy.maximumAgeMinutes.caiso)) throw new Error('Invalid public-input policy');
  if (!input.model || !Number.isFinite(input.model.computeKWh) || input.model.computeKWh <= 0 || input.model.computeKWh > 1_000_000
    || !Number.isFinite(input.model.roundTripEfficiency) || input.model.roundTripEfficiency <= 0 || input.model.roundTripEfficiency > 1) throw new Error('Invalid storage assumptions');
  // Canonical fields also make idempotency independent of incoming object-key order.
  return { requestId: input.requestId,
    workload: kind === 'integer-sum' ? { kind, values: [...input.workload.values] } : { kind },
    inputRevisions: { eia: input.inputRevisions.eia, caiso: input.inputRevisions.caiso },
    policy: { maximumDemandMW: policy.maximumDemandMW, maximumWholesaleUsdPerMWh: policy.maximumWholesaleUsdPerMWh,
      maximumAgeMinutes: { eia: policy.maximumAgeMinutes.eia, caiso: policy.maximumAgeMinutes.caiso } },
    model: { computeKWh: input.model.computeKWh, roundTripEfficiency: input.model.roundTripEfficiency } };
}
export function createJobsApi(jobs: LocalRuns) {
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
            if (new URL(request.headers.origin).origin !== new URL(`${scheme}://${request.headers.host}`).origin) throw new Error('Origin mismatch');
          } catch { send(response, 403, { error: 'Cross-origin execution is not allowed.' }); return; }
        }
        if (!request.headers['content-type']?.startsWith('application/json')) { send(response, 415, { error: 'Use application/json.' }); return; }
        let text = '';
        for await (const part of request) { text += part.toString(); if (Buffer.byteLength(text) > 256_000) { send(response, 413, { error: 'Run request is too large.' }); return; } }
        let input: LocalRunRequest;
        try { input = requestValue(JSON.parse(text)); } catch { send(response, 400, { error: 'Invalid workload, policy, revision, or model assumptions.' }); return; }
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
