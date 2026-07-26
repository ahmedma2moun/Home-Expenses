import type { AnalysisProvider, ExtractionProvider } from "@/lib/ai/types";
import {
  getAnalysisModel,
  getAnalysisProviderName,
  getExtractionModel,
  getExtractionProviderName,
} from "@/lib/ai/config";
import { GeminiProvider } from "@/lib/ai/gemini/provider";
import { AnthropicProvider } from "@/lib/ai/anthropic/provider";

export function getExtractionProvider(): ExtractionProvider {
  const model = getExtractionModel();
  switch (getExtractionProviderName()) {
    case "gemini":
      return new GeminiProvider(model);
    case "anthropic":
      return new AnthropicProvider(model);
  }
}

export function getAnalysisProvider(): AnalysisProvider {
  const model = getAnalysisModel();
  switch (getAnalysisProviderName()) {
    case "gemini":
      return new GeminiProvider(model);
    case "anthropic":
      return new AnthropicProvider(model);
  }
}

export type { AnalysisProvider, ExtractionProvider } from "@/lib/ai/types";
