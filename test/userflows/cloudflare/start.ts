import { cloudflareRuntime } from './runtime.ts';
export default async function startCloudflareFlows() {
  const runtime = await cloudflareRuntime(4178);
  return runtime.dispose;
}
