import { GroqChatLLM } from "bee-agent-framework/adapters/groq/chat";
import { IBMVllmChatLLM } from "bee-agent-framework/adapters/ibm-vllm/chat";
import { OllamaChatLLM } from "bee-agent-framework/adapters/ollama/chat";
import { OpenAIChatLLM } from "bee-agent-framework/adapters/openai/chat";
import { VertexAIChatLLM } from "bee-agent-framework/adapters/vertexai/chat";
import { WatsonXChatLLM } from "bee-agent-framework/adapters/watsonx/chat";
import { getEnv, parseEnv } from "bee-agent-framework/internals/env";
import { ChatLLM, ChatLLMOutput } from "bee-agent-framework/llms/chat";
import Groq from "groq-sdk";
import { Ollama } from "ollama";
import OpenAI from "openai";
import { AgentKindEnum } from "@/agents/registry/dto.js";
import { z } from "zod";

export const Providers = {
  WATSONX: "watsonx",
  OLLAMA: "ollama",
  OPENAI: "openai",
  GROQ: "groq",
  AZURE: "azure",
  VERTEXAI: "vertexai",
  IBM_VLLM: "ibm_vllm",
  IBM_RITS: "ibm_rits",
} as const;
type Provider = (typeof Providers)[keyof typeof Providers];

const env = (name: string, type: AgentKindEnum) => `${name}_${type.toUpperCase()}`;

export const LLMFactories: Record<Provider, (type: AgentKindEnum) => ChatLLM<ChatLLMOutput>> = {
  [Providers.GROQ]: (type: AgentKindEnum) =>
    new GroqChatLLM({
      modelId: getEnv(env(`GROQ_MODEL`, type)) || "llama-3.1-70b-versatile",
      client: new Groq({
        apiKey: getEnv("GROQ_API_KEY"),
      }),
    }),
  [Providers.OPENAI]: (type: AgentKindEnum) =>
    new OpenAIChatLLM({
      modelId: getEnv(env("OPENAI_MODEL", type)) || "gpt-4o",
      parameters: {
        temperature: 0,
        max_tokens: 2048,
      },
    }),
  [Providers.IBM_RITS]: (type: AgentKindEnum) =>
    new OpenAIChatLLM({
      client: new OpenAI({
        baseURL: getEnv(env("IBM_RITS_URL", type)),
        apiKey: getEnv("IBM_RITS_API_KEY"),
        defaultHeaders: {
          RITS_API_KEY: getEnv("IBM_RITS_API_KEY"),
        },
      }),
      modelId: getEnv(env("IBM_RITS_MODEL", type)) || "",
    }),
  [Providers.OLLAMA]: (type: AgentKindEnum) =>
    new OllamaChatLLM({
      modelId: getEnv(env("OLLAMA_MODEL", type)) || "llama3.1:8b",
      parameters: {
        temperature: 0,
      },
      client: new Ollama({
        host: getEnv("OLLAMA_HOST"),
      }),
    }),
  [Providers.WATSONX]: (type: AgentKindEnum) =>
    WatsonXChatLLM.fromPreset(
      getEnv(env("WATSONX_MODEL", type)) || "meta-llama/llama-3-1-70b-instruct",
      {
        apiKey: getEnv("WATSONX_API_KEY"),
        projectId: getEnv("WATSONX_PROJECT_ID"),
        region: getEnv("WATSONX_REGION"),
      },
    ),
  [Providers.AZURE]: (type: AgentKindEnum) =>
    new OpenAIChatLLM({
      modelId: getEnv(env("OPENAI_MODEL", type)) || "gpt-4o-mini",
      azure: true,
      parameters: {
        temperature: 0,
        max_tokens: 2048,
      },
    }),
  [Providers.VERTEXAI]: (type: AgentKindEnum) =>
    new VertexAIChatLLM({
      modelId: getEnv(env("VERTEXAI_MODEL", type)) || "gemini-1.5-flash-001",
      location: getEnv("VERTEXAI_LOCATION") || "us-central1",
      project: getEnv("VERTEXAI_PROJECT"),
      parameters: {},
    }),
  [Providers.IBM_VLLM]: (type: AgentKindEnum) =>
    IBMVllmChatLLM.fromPreset(getEnv(env("IBM_VLLM_MODEL", type))),
};

export function getChatLLM(type: AgentKindEnum, provider?: Provider): ChatLLM<ChatLLMOutput> {
  if (!provider) {
    provider = parseEnv("LLM_BACKEND", z.nativeEnum(Providers), Providers.OLLAMA);
  }

  const factory = LLMFactories[provider];
  if (!factory) {
    throw new Error(`Provider "${provider}" not found.`);
  }
  return factory(type);
}
