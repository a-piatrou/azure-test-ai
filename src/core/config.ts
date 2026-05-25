import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { ConfigSchema, type Config } from './config-schema.js';
import { ConfigError } from './errors.js';

export interface LoadedConfig {
  config: Config;
  pat: string;
  anthropicApiKey?: string;
  configPath: string;
}

export const DEFAULT_CONFIG_PATH = '.testcasesync.json';

export async function loadConfig(configPath = DEFAULT_CONFIG_PATH): Promise<LoadedConfig> {
  loadEnv();

  const absPath = resolve(configPath);
  if (!existsSync(absPath)) {
    throw new ConfigError(
      `Config file not found: ${absPath}`,
      `Run "npx tsx src/index.ts init" to scaffold ${DEFAULT_CONFIG_PATH}`,
    );
  }

  let raw: unknown;
  try {
    const text = await readFile(absPath, 'utf8');
    raw = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(
      `Failed to parse ${absPath}: ${(err as Error).message}`,
      'Make sure the file is valid JSON (no trailing commas, double-quoted keys)',
    );
  }

  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`Invalid config:\n${issues}`);
  }

  const pat = process.env.AZURE_DEVOPS_PAT?.trim();
  if (!pat) {
    throw new ConfigError(
      'AZURE_DEVOPS_PAT environment variable is required',
      'Copy .env.example to .env and put your Personal Access Token there',
    );
  }

  return {
    config: parsed.data,
    pat,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
    configPath: absPath,
  };
}

export function describeConfig(loaded: LoadedConfig): string {
  const c = loaded.config;
  const projects = c.projects
    .map(
      (p) =>
        `  - ${p.name} ` +
        `(planIds=[${p.planIds.join(',')}]${p.suiteIds.length ? `, suiteIds=[${p.suiteIds.join(',')}]` : ''}` +
        `${p.areaPath ? `, area=${p.areaPath}` : ''}` +
        `${p.tags.length ? `, tags=[${p.tags.join(',')}]` : ''})`,
    )
    .join('\n');
  return [
    `organization: ${c.organization}`,
    `outputDir: ${c.outputDir}`,
    `concurrency: ${c.concurrency}`,
    `incrementalSync: ${c.incrementalSync}`,
    `git.enabled: ${c.git.enabled}`,
    `projects:\n${projects}`,
  ].join('\n');
}
