import { productionConfiguration } from './productionConfiguration.ts';
import { startProductionServer } from './productionServer.ts';

try {
  const configuration = productionConfiguration(process.env);
  const application = await startProductionServer(configuration);
  console.info(`Sunchaser listening on ${configuration.host}:${application.port}`);
  const stop = () => { void application.close().catch(() => { process.exitCode = 1; }); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
} catch {
  // Environment values and upstream errors can contain credentials; keep logs bounded and secret-free.
  console.error('Sunchaser startup failed. Check the required runtime configuration, built UI, writable data directories and available port.');
  process.exitCode = 1;
}
