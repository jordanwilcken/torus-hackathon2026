import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createJobsApi } from '../../../src/server/jobs/jobsApi';
import type { LocalRuns } from '../../../src/server/jobs/localRuns';
let server: Server;
let base: string;
const submit = vi.fn(async () => ({ status: 'queued' }));
const request = () => ({ requestId: '00000000-0000-0000-0000-000000000001', workload: { kind: 'integer-sum', values: [1,2,3,4] },
  inputRevisions: { eia: 'a'.repeat(64), caiso: 'b'.repeat(64) },
  policy: { maximumDemandMW: 20000, maximumWholesaleUsdPerMWh: 100, maximumAgeMinutes: { eia: 240, caiso: 30 } },
  model: { computeKWh: 1, roundTripEfficiency: .9 } });
beforeEach(async () => {
  submit.mockClear();
  const middleware = createJobsApi({ submit } as unknown as LocalRuns);
  server = createServer((req,res) => middleware(req,res,() => { res.writeHead(404); res.end(); }));
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  base = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
});
const post = (body: unknown, origin = base) => fetch(base+'/api/jobs/runs',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});

test('HTTP accepts only the allowlisted structured workload and canonicalizes request fields',async () => {
  const response = await post({...request(),shell:'ignored; never executable'});
  expect(response.status).toBe(202);
  expect(submit).toHaveBeenCalledWith(request());
});
test('zero freshness limits are rejected before admission',async () => {
  const value=request();value.policy.maximumAgeMinutes.eia=0;
  expect((await post(value)).status).toBe(400);
  expect(submit).not.toHaveBeenCalled();
});
test.each(['null','invalid-origin','https://same-host','https://other.invalid'])('origin %s cannot start local work',async origin => {
  const value=origin==='https://same-host'?base.replace('http:','https:'):origin;
  expect((await post(request(),value)).status).toBe(403);
  expect(submit).not.toHaveBeenCalled();
});
test('an arbitrary executable cannot be requested',async () => {
  const value={...request(),workload:{kind:'shell',command:'echo nope'}};
  expect((await post(value)).status).toBe(400);
  expect(submit).not.toHaveBeenCalled();
});
