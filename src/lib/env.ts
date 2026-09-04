import { z } from 'zod';

const envSchema = z.object({
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_PRO_MODEL: z.string().default('gemini-2.5-pro'),
  DATABASE_URL: z.string().optional(),
  ADMIN_API_SECRET: z.string().default('dev-secret-nakshatra-key'),
  CRON_SECRET: z.string().default('dev-cron-secret-nakshatra'),
  RESEND_API_KEY: z.string().optional(),
  NEWSLETTER_FROM_EMAIL: z.string().default('briefings@nakshatra.ai'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  NEXT_PUBLIC_APP_URL: z.string().default('http://localhost:3000'),
  NEXT_PUBLIC_SITE_URL: z.string().default('http://localhost:3000'),
});

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(rawEnv: Record<string, string | undefined> = process.env): AppEnv {
  const result = envSchema.safeParse({
    GEMINI_API_KEY: rawEnv.GEMINI_API_KEY,
    GEMINI_MODEL: rawEnv.GEMINI_MODEL,
    GEMINI_PRO_MODEL: rawEnv.GEMINI_PRO_MODEL,
    DATABASE_URL: rawEnv.DATABASE_URL,
    ADMIN_API_SECRET: rawEnv.ADMIN_API_SECRET,
    CRON_SECRET: rawEnv.CRON_SECRET,
    RESEND_API_KEY: rawEnv.RESEND_API_KEY,
    NEWSLETTER_FROM_EMAIL: rawEnv.NEWSLETTER_FROM_EMAIL,
    NODE_ENV: rawEnv.NODE_ENV,
    NEXT_PUBLIC_APP_URL: rawEnv.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SITE_URL: rawEnv.NEXT_PUBLIC_SITE_URL,
  });

  if (!result.success) {
    // Sanitize issues to avoid exposing secret values
    const sanitizedIssues = result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    throw new Error(`Environment validation failed: ${JSON.stringify(sanitizedIssues)}`);
  }

  return result.data;
}

export const env = parseEnv(process.env);

export function validateProductionEnv(rawEnv: Record<string, string | undefined> = process.env): {
  valid: boolean;
  missing: string[];
} {
  const requiredProductionKeys: (keyof AppEnv)[] = [
    'GEMINI_API_KEY',
    'CRON_SECRET',
    'ADMIN_API_SECRET',
    'DATABASE_URL',
  ];

  const missing = requiredProductionKeys.filter((key) => {
    const val = rawEnv[key];
    return !val || val.trim().length === 0 || val.includes('placeholder');
  });

  return {
    valid: missing.length === 0,
    missing,
  };
}

