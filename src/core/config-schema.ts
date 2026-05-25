import { z } from 'zod';

export const ProjectConfigSchema = z.object({
  name: z.string().min(1, 'project.name must not be empty'),
  planIds: z.array(z.number().int().positive()).default([]),
  suiteIds: z.array(z.number().int().positive()).default([]),
  areaPath: z.string().default(''),
  tags: z.array(z.string()).default([]),
});

export const ConfigSchema = z
  .object({
    organization: z.string().min(1, 'organization is required'),
    projects: z.array(ProjectConfigSchema).min(1, 'at least one project required'),
    outputDir: z.string().default('./test-cases'),
    downloadAttachments: z.boolean().default(true),
    maxAttachmentSize: z.number().int().positive().default(10 * 1024 * 1024),
    incrementalSync: z.boolean().default(true),
    concurrency: z.number().int().min(1).max(20).default(5),
    apiVersion: z.string().default('7.1'),
    inlineSharedSteps: z.boolean().default(true),
    pruneDeleted: z.boolean().default(false),

    // Extra features beyond start.md spec
    git: z
      .object({
        enabled: z.boolean().default(false),
        autoCommit: z.boolean().default(true),
        commitMessage: z.string().default('chore(test-sync): sync test cases'),
        signoff: z.boolean().default(false),
      })
      .default({}),
    review: z
      .object({
        model: z.string().default('claude-opus-4-7'),
        defaultBaseUrl: z.string().optional(),
        autoApplyAboveConfidence: z.number().min(1).max(5).optional(),
        capturePlaywrightTrace: z.boolean().default(true),
      })
      .default({}),
    quality: z
      .object({
        minStepCount: z.number().int().min(0).default(2),
        minDescriptionLength: z.number().int().min(0).default(20),
        useLlm: z.boolean().default(false),
      })
      .default({}),
  })
  .strict();

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: Partial<Config> = {
  outputDir: './test-cases',
  downloadAttachments: true,
  maxAttachmentSize: 10 * 1024 * 1024,
  incrementalSync: true,
  concurrency: 5,
  apiVersion: '7.1',
  inlineSharedSteps: true,
  pruneDeleted: false,
};
