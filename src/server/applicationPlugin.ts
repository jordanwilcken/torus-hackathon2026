import type { Plugin, ViteDevServer, PreviewServer } from 'vite';
import { createApplication, type ApplicationOptions } from './application.ts';

export function createApplicationPlugin(options: ApplicationOptions): Plugin {
  async function install(server: ViteDevServer | PreviewServer) {
    const application = await createApplication(options);
    server.middlewares.use(application.handle);
    server.httpServer?.once('close', () => { void application.close(); });
  }
  return { name: 'public-grid-and-local-execution', configureServer: install, configurePreviewServer: install };
}
