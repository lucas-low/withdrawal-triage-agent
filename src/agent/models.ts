import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import type { Config } from "../config";
import { createMockModel } from "./mock-model";

export function createModel(config: Pick<Config, "modelProvider" | "model" | "mockBehavior" | "anthropicApiKey">): {
  model: LanguageModel;
  name: string;
} {
  if (config.modelProvider === "mock") {
    const model = createMockModel(config.mockBehavior);
    return { model, name: model.modelId };
  }
  void anthropic; // keep the default instance import tree-shake friendly; we use an explicit key below
  const provider = createAnthropic({ apiKey: config.anthropicApiKey });
  return { model: provider(config.model), name: config.model };
}
