import { expect, test } from 'vitest';
import { productionConfiguration } from '../../../src/server/productionConfiguration.ts';
import { validatePublicOrigin } from '../../../src/server/productionServer.ts';

const environment = {
  EIA_API_KEY: 'server-only-test-key', PUBLIC_ORIGIN: 'https://demo.example.com',
  DEMO_USERNAME: 'judge', DEMO_PASSWORD: 'a-long-test-password',
};
test('production uses private runtime credentials and persistent directories without a Vite environment', () => {
  const result = productionConfiguration({ ...environment, GRID_SNAPSHOT_DIR: '/data/grid', JOB_RUN_DIRECTORY: '/data/jobs' });
  expect(result.application.apiKey).toBe('server-only-test-key');
  expect(result.application.archiveDirectory.replaceAll('\\', '/')).toMatch(/\/data\/grid$/);
  expect(result.application.runDirectory.replaceAll('\\', '/')).toMatch(/\/data\/jobs$/);
  expect(result.host).toBe('127.0.0.1');
  expect(result.port).toBe(3000);
});
test('missing EIA credentials cannot silently launch a supposed live demo', () => {
  expect(() => productionConfiguration({ ...environment, EIA_API_KEY: '' })).toThrow('EIA_API_KEY');
});
test.each(['0', '-1', '3.5', '70000', 'abc'])('invalid port %s is refused before opening a listener', port => {
  expect(() => productionConfiguration({ ...environment, PORT: port })).toThrow('PORT');
});
test.each(['http://demo.example.com', 'https://demo.example.com/path', 'https://user:password@demo.example.com', 'https://demo.example.com/?key=value', 'https://demo.example.com/#fragment', 'null'])('unsafe public origin %s is refused', origin => {
  expect(() => validatePublicOrigin(origin)).toThrow('PUBLIC_ORIGIN');
});
test('only explicit loopback addresses may use plain HTTP for a local production-server check', () => {
  expect(validatePublicOrigin('http://127.0.0.1:5196')).toBe('http://127.0.0.1:5196');
  expect(validatePublicOrigin('http://localhost:5196')).toBe('http://localhost:5196');
  expect(validatePublicOrigin('http://[::1]:5196')).toBe('http://[::1]:5196');
  expect(() => validatePublicOrigin('http://127.0.0.1.attacker.example')).toThrow();
});
