import chalk from 'chalk';
import Table from 'cli-table3';
import type { SyncResult } from '../core/types.js';

export function formatSyncResultText(r: SyncResult, organization: string): string {
  const lines: string[] = [];
  lines.push(chalk.bold(`Sync complete (${organization}) ${r.dryRun ? chalk.yellow('[DRY-RUN]') : ''}`));
  lines.push(`  ${chalk.green('+')} added:     ${r.added.length}`);
  lines.push(`  ${chalk.yellow('~')} updated:   ${r.updated.length}`);
  lines.push(`  ${chalk.gray('·')} unchanged: ${r.unchanged.length}`);
  lines.push(`  ${chalk.red('-')} deleted:   ${r.deleted.length}`);
  if (r.errors.length) {
    lines.push(`  ${chalk.red('!')} errors:    ${r.errors.length}`);
    for (const err of r.errors.slice(0, 10)) {
      lines.push(`      [${err.stage}${err.testCaseId ? ` #${err.testCaseId}` : ''}] ${err.message}`);
    }
    if (r.errors.length > 10) lines.push(`    ... ${r.errors.length - 10} more`);
  }
  lines.push(`  ${chalk.gray('⏱')} duration:  ${(r.durationMs / 1000).toFixed(2)}s`);
  return lines.join('\n');
}

export function table(headers: string[], rows: string[][]): string {
  const t = new Table({ head: headers, style: { head: ['cyan'] } });
  for (const r of rows) t.push(r);
  return t.toString();
}

export function bytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`;
  return `${(n / 1024 / 1024).toFixed(1)}M`;
}
