import { prisma } from "@/lib/db/prisma";
import { getExtractionProviderName } from "@/lib/ai/config";

export interface HealthCheck {
  ok: boolean;
  error?: string;
}

export interface HealthReport {
  status: "ok" | "degraded";
  db: HealthCheck;
  ai: HealthCheck;
}

export async function getHealthReport(): Promise<HealthReport> {
  const db = await checkDb();
  const ai = checkAiConfig();
  return { status: db.ok && ai.ok ? "ok" : "degraded", db, ai };
}

async function checkDb(): Promise<HealthCheck> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown database error." };
  }
}

const PROVIDER_ENV_VAR = {
  gemini: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
} as const;

function checkAiConfig(): HealthCheck {
  const provider = getExtractionProviderName();
  const envVar = PROVIDER_ENV_VAR[provider];
  return process.env[envVar]
    ? { ok: true }
    : { ok: false, error: `${envVar} is not configured for EXTRACTION_PROVIDER=${provider}.` };
}
