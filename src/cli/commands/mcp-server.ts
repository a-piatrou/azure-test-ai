import { loadConfig } from '../../core/config.js';
import { startMcpServer } from '../../mcp/server.js';

export interface McpServerOpts {
  config?: string;
}

export async function runMcpServer(opts: McpServerOpts): Promise<void> {
  const loaded = await loadConfig(opts.config);
  await startMcpServer(loaded);
}
