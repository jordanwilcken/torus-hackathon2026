import type { LocalRunRequest } from '../../data/LocalRun.type.ts';
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const revisionPattern = /^[a-f0-9]{64}$/;
export function validateLocalRunRequest(value: unknown): LocalRunRequest {
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
