import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { Config } from "../config";
import { createMockModel } from "./mock-model";

type ModelConfig = Pick<Config, "modelProvider" | "model" | "mockBehavior" | "anthropicApiKey" | "ollamaUrl">;

export function createModel(config: ModelConfig): { model: LanguageModel; name: string } {
  switch (config.modelProvider) {
    case "mock": {
      const model = createMockModel(config.mockBehavior);
      return { model, name: model.modelId };
    }
    case "ollama": {
      // Ollama exposes an OpenAI-compatible endpoint, so tool calling goes through the same path as any hosted model.
      const provider = createOpenAICompatible({ name: "ollama", baseURL: config.ollamaUrl });
      return { model: provider(config.model), name: `ollama/${config.model}` };
    }
    case "anthropic":
      return { model: createAnthropic({ apiKey: config.anthropicApiKey })(config.model), name: config.model };
  }
}
