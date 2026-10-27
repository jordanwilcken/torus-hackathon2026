// Vitest's JSON omits expected-failure and retry diagnostics. Preserve them in
// its supported metadata field. This synchronous reporter is registered before
// JSON so the audit is present when the JSON reporter serializes the results.
export default class ScoreVitestReporter {
  onTestRunEnd(modules, unhandledErrors, reason) {
    const runErrors = unhandledErrors.map(error => error.message ?? String(error));
    for (const module of modules) {
      for (const test of module.children.allTests()) {
        const diagnostic = test.diagnostic();
        test.meta().scoreAudit = {
          version: 1,
          project: test.project.name,
          expectedFailure: test.options.fails === true,
          retryCount: diagnostic?.retryCount ?? null,
          repeatCount: diagnostic?.repeatCount ?? null,
          runErrors,
          interrupted: reason === 'interrupted',
        };
      }
    }
  }
}
