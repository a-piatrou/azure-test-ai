import pino from 'pino';

const isCI = process.env.CI === 'true' || process.env.CI === '1';
const level = process.env.LOG_LEVEL ?? 'info';

export const logger = pino({
  level,
  transport: isCI
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname',
          singleLine: false,
        },
      },
});

export function setVerbose(verbose: boolean): void {
  if (verbose) logger.level = 'debug';
}
