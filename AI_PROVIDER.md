# AI Provider — Change Record & Design

> **Change:** the AI layer is no longer hard-wired to the Claude API. It now sits behind a small
> **provider interface**, with **Google Gemini's free tier** as the default and a **self-hosted Ollama**
> option for private data. Claude remains a drop-in provider.
>
> This document is the source of truth for the AI layer. Where it conflicts with the
> "Claude API" wording still present in `PROJECT_SPEC.md`, this document wins. `README.md` has been
> updated to match.

---

## 1. Why this change

The app has two AI calls, and they have different needs:

1. **Extraction** — reads receipt **images** (needs vision), must return strict JSON, and handles PII.
2. **Comparison** — month-vs-month narrative from **aggregates only** (text-only, low volume).

Requirements that drove the decision:

- **Vision is mandatory** for extraction. That eliminates most "free" text-only tiers.
- **Free to build with.** A household expense tracker shouldn't need a funded API account to prototype.
- **PII-aware.** Receipts contain names, card last-4, addresses. Where data goes matters.
- **No lock-in.** Gemini, Groq, OpenRouter, and Anthropic all expose OpenAI-compatible or near-identical
  message APIs, so the provider should be swappable by config, not by rewrite.

## 2. Decision

| Concern | Choice |
|---|---|
| Default provider (build / prototype) | **Google Gemini `gemini-3.5-flash`** — free tier, native vision, structured JSON output |
| Private / production-grade privacy | **Self-hosted Ollama** vision model (`qwen2.5vl` or `llama3.2-vision`) — zero cost, nothing leaves the machine |
| Highest extraction quality (paid) | **Anthropic Claude** (`claude-sonnet-5`) or **Gemini paid tier** |
| Comparison call (text-only) | Any of the above; can be routed to a separate free text tier (Groq / Cerebras) to spread quota |

The extraction and comparison calls are configured **independently**, so you can (for example) run
extraction on local Ollama for privacy while sending the aggregate-only comparison to Gemini.

## 3. Privacy caveat you must understand

Free tiers are paid for with data. **Google may use free-tier Gemini inputs to improve its models;
paid-tier inputs are not used for training.** Since receipts are PII:

- Personal / hobby use → Gemini free tier is fine.
- Anything real or shared → use **Gemini paid tier** (cheap: an image is ~258 input tokens, a fraction
  of a cent) **or** the **Ollama** provider so images never leave your infrastructure.

Ollama is the only option here where receipt images are never sent to a third party at all.

## 4. Design — the provider interface

One interface, one factory, swappable by env var. Route handlers and services never know which
provider is behind it.

```ts
// apps/web/lib/ai/types.ts
export interface ExtractionProvider {
  /** Vision: read receipt images, return the strict parsed receipt JSON. */
  extract(images: ReceiptImage[], schema: ZodSchema<ParsedReceipt>): Promise<ExtractionResult>;
}

export interface AnalysisProvider {
  /** Text: month-vs-month narrative from aggregates (never raw items). */
  compare(diff: MonthDiff, schema: ZodSchema<Comparison>): Promise<AnalysisResult>;
}

export interface AiResult {
  model: string;
  inputTokens?: number;   // may be absent for local models
  outputTokens?: number;
  latencyMs: number;
}
```

```ts
// apps/web/lib/ai/index.ts
export function getExtractionProvider(): ExtractionProvider {
  switch (env.EXTRACTION_PROVIDER) {
    case "gemini":    return new GeminiProvider(env.GEMINI_API_KEY, env.EXTRACTION_MODEL);
    case "ollama":    return new OllamaProvider(env.OLLAMA_BASE_URL, env.EXTRACTION_MODEL);
    case "anthropic": return new AnthropicProvider(env.ANTHROPIC_API_KEY, env.EXTRACTION_MODEL);
    default:          throw new AppError("config", "Unknown EXTRACTION_PROVIDER");
  }
}
// getAnalysisProvider() mirrors this with ANALYSIS_PROVIDER / ANALYSIS_MODEL.
```

Contract that every provider must honor, so the rest of the app is unchanged:

- **Input:** images in `position` order (base64 + MIME) + the versioned prompt from `docs/prompts/`.
- **Output:** an object that passes the **same Zod schema** used today. Providers that support native
  structured output (Gemini `responseSchema`, Anthropic tool-use) should use it; others get the JSON
  contract in the prompt and are validated + one-shot-repaired server-side, exactly as the spec
  already describes.
- **Telemetry:** return `model`, token counts when available, and `latencyMs` for the existing
  cost-tracking columns on `Receipt`. Local models simply report `null` token counts.
- **Resilience:** timeout + retry with backoff on 429/5xx (unchanged from the spec).

Because the contract is identical, the **review/confirm flow, the Zod schema, the DB columns, the
prompt-eval suite, and the iOS app do not change.** Only the code behind the interface does.

## 5. Environment variables

**Removed / replaced** (old Claude-only vars):

```bash
# OLD
ANTHROPIC_API_KEY=...
CLAUDE_EXTRACTION_MODEL=claude-sonnet-5
CLAUDE_ANALYSIS_MODEL=claude-sonnet-5
```

**New — provider-based:**

```bash
# Which provider handles each call: gemini | ollama | anthropic
EXTRACTION_PROVIDER="gemini"
ANALYSIS_PROVIDER="gemini"

# Model per call (values depend on the chosen provider)
EXTRACTION_MODEL="gemini-3.5-flash"
ANALYSIS_MODEL="gemini-3.5-flash"

# Credentials — only set the ones your chosen providers need
GEMINI_API_KEY="AIza..."                 # if any provider is 'gemini'
OLLAMA_BASE_URL="http://localhost:11434" # if any provider is 'ollama'
ANTHROPIC_API_KEY="sk-ant-..."           # if any provider is 'anthropic'

# Guardrails (unchanged)
RATE_LIMIT_PARSES_PER_DAY="50"
```

Model values by provider:

| Provider | `EXTRACTION_MODEL` (vision) | `ANALYSIS_MODEL` (text) |
|---|---|---|
| gemini | `gemini-3.5-flash` | `gemini-3.5-flash` (or `gemini-3.5-flash-lite`) |
| ollama | `qwen2.5vl` / `llama3.2-vision` | `llama3.1` (any local text model) |
| anthropic | `claude-sonnet-5` | `claude-sonnet-5` (or `claude-haiku-4-5`) |

## 6. Get a Gemini API key (default provider)

Free tier, **no credit card** on most models.

1. Go to **[aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)** and sign in with a
   Google account. AI Studio is the developer surface — distinct from the consumer Gemini app.
2. Click **Create API key** and let it create (or pick) a Google Cloud project.
3. Copy the key — it starts with `AIza`. Unlike Anthropic, AI Studio keeps the key **visible**, so you
   can re-copy it later from the same page.
4. **Restrict the key.** As of mid-2026 Google blocks unrestricted keys — on the API keys page, if the
   key shows an "unrestricted" tag, click **Restrict to Gemini API** (or set it under Google Cloud
   Console → APIs & Services → Credentials).
5. Put it in `GEMINI_API_KEY`. Free-tier limits on `gemini-3.5-flash` are modest (roughly 10 requests
   per minute and a few hundred per day, and Google changes these) — fine for a household tracker.

> **EEA / UK / Switzerland:** Google requires billing enabled even for free-eligible models. Enabling
> billing costs nothing until you make paid calls, and it also stops your inputs being used for
> training — worth it for receipt PII.

### Verify the Gemini key

```bash
curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Reply with the single word: ok"}]}]}'
```

## 7. Get the Ollama provider running (private option)

Best on your own Apple Silicon / Linux box. Note it only serves while that machine is on, so it fits a
"process on my machine" design better than a pure Vercel-serverless backend.

```bash
# install: https://ollama.com/download
ollama pull qwen2.5vl        # vision model for extraction
ollama pull llama3.1         # text model for comparison (optional)
ollama serve                 # exposes http://localhost:11434
```

Then set `EXTRACTION_PROVIDER=ollama`, `EXTRACTION_MODEL=qwen2.5vl`, `OLLAMA_BASE_URL=http://localhost:11434`.
For a Vercel-hosted backend to reach a local Ollama you'd need to expose it (tunnel / small always-on
host); for local-first development it just works.

## 8. Impact on the rest of the project

- **`PROJECT_SPEC.md` §7 (Claude API Integration):** conceptually replaced by the provider interface
  here. The prompts (§7.2/§7.3), the JSON output contract, the Zod validation, and the cost columns are
  all unchanged — they now live behind `lib/ai/` instead of `lib/claude/`.
- **`AGENTS_AND_SKILLS.md`:** the `prompt-change` skill and `prompt-eval-runner` agent still apply
  verbatim — prompts are provider-agnostic. Add one eval requirement: **when you switch or upgrade a
  provider/model, re-run `npm run eval:extraction`** and record the accuracy + cost delta, exactly as
  for a prompt change. A provider swap is a model change and goes through the same gate.
- **iOS app & API contract:** no change. The phone still holds no AI credential and only talks to the
  backend.
- **`docs/` folder:** `docs/prompts/` stays; rename `lib/claude/` → `lib/ai/` with provider subfolders
  (`lib/ai/gemini`, `lib/ai/ollama`, `lib/ai/anthropic`).

## 9. Recommendation

Build and prototype on **Gemini `gemini-3.5-flash`** (free, native vision, structured output). Keep an
**Ollama** provider behind the same interface for private data and offline work. If extraction accuracy
or PII handling later demands it, flip `EXTRACTION_PROVIDER` to `anthropic` or Gemini paid — no code
change, no schema change, and the eval suite tells you whether the swap helped.

## Docs

- Gemini API key — https://aistudio.google.com/app/apikey
- Gemini free-tier limits & pricing — https://ai.google.dev/gemini-api/docs/pricing
- Gemini structured output — https://ai.google.dev/gemini-api/docs/structured-output
- Gemini vision / image input — https://ai.google.dev/gemini-api/docs/vision
- Ollama — https://ollama.com/download
- Claude API (optional provider) — https://docs.claude.com/en/api/overview
