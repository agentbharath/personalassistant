import { z } from "zod";

const serverEnvironmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  APP_ENCRYPTION_KEY: z.string().min(32),
  PII_HMAC_KEY: z.string().min(32),
  INTERNAL_TOKEN_SIGNING_KEY: z.string().min(48),
  CRON_SECRET: z.string().min(32),
  ANTHROPIC_API_KEY: z.string().min(1),
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function getServerEnvironment(): ServerEnvironment {
  return serverEnvironmentSchema.parse(process.env);
}
