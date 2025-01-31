import { Emitter } from "bee-agent-framework/emitter/emitter";
import {
  BaseToolOptions,
  JSONToolOutput,
  Tool,
  ToolEmitter,
  ToolInput,
} from "bee-agent-framework/tools/base";
import { z } from "zod";
import {
  Agent,
  AgentConfig,
  AgentConfigSchema,
  AgentInstanceRef,
  AgentKindSchema,
  AgentRegistry,
  PoolStats,
} from "./agent-registry.js";

export interface AgentRegistryToolInput extends BaseToolOptions {
  registry: AgentRegistry<unknown>;
}

export type AgentRegistryToolResultData =
  | string[]
  | void
  | AgentConfig
  | string
  | Agent[]
  | Agent
  | PoolStats
  | AgentInstanceRef<unknown>;

export interface AgentRegistryToolResult {
  method: string;
  success: boolean;
  data: AgentRegistryToolResultData;
}

export const GetAvailableToolsSchema = z
  .object({
    method: z.literal("getAvailableTools"),
    agentKind: AgentKindSchema,
  })
  .describe("Get all available tools usable in agents");

export const RegisterAgentTypeSchema = z
  .object({
    method: z.literal("registerAgentType"),
    config: AgentConfigSchema,
  })
  .describe("Register a new agent type with its configuration");

export const GetAgentTypesSchema = z
  .object({
    method: z.literal("getAgentTypes"),
  })
  .describe("Get all registered agent types");

export const GetAgentTypeConfigSchema = z
  .object({
    method: z.literal("getAgentTypeConfig"),
    agentKind: AgentKindSchema,
    type: z.string(),
  })
  .describe("Get configuration for a specific agent type");

export const AcquireAgentSchema = z
  .object({
    method: z.literal("acquireAgent"),
    agentKind: AgentKindSchema,
    type: z.string(),
  })
  .describe("Acquire an agent instance from the pool or create a new one");

export const ReleaseAgentSchema = z
  .object({
    method: z.literal("releaseAgent"),
    agentId: z.string(),
  })
  .describe("Release an agent back to the pool or destroy it");

export const DestroyAgentSchema = z
  .object({
    method: z.literal("destroyAgent"),
    agentId: z.string(),
  })
  .describe("Destroy an existing agent instance");

export const GetActiveAgentsSchema = z
  .object({
    method: z.literal("getActiveAgents"),
  })
  .describe("Get all active agent instances");

export const GetAgentSchema = z
  .object({
    method: z.literal("getAgent"),
    agentId: z.string(),
  })
  .describe("Get a specific agent instance by ID");

export const GetPoolStatsSchema = z
  .object({
    method: z.literal("getPoolStats"),
    agentKind: AgentKindSchema,
    type: z.string(),
  })
  .describe("Get statistics about the agent pool for a specific type");

/**
 * Tool for interacting with the AgentRegistry
 * Provides methods for managing agent types, instances, and pools
 */
export class AgentRegistryTool extends Tool<
  JSONToolOutput<AgentRegistryToolResult>,
  AgentRegistryToolInput
> {
  name = "agent_registry";
  description =
    "The registry is used for managing AI agent configurations, instances, and agent pools.";

  static {
    this.register();
  }

  private registry: AgentRegistry<unknown>;

  public readonly emitter: ToolEmitter<ToolInput<this>, JSONToolOutput<AgentRegistryToolResult>> =
    Emitter.root.child({
      namespace: ["tool", "agent_registry"],
      creator: this,
    });

  constructor(protected readonly input: AgentRegistryToolInput) {
    super(input);
    this.registry = input.registry;
  }

  inputSchema() {
    return z.discriminatedUnion("method", [
      GetAvailableToolsSchema,
      RegisterAgentTypeSchema,
      GetAgentTypesSchema,
      GetAgentTypeConfigSchema,
      AcquireAgentSchema,
      ReleaseAgentSchema,
      DestroyAgentSchema,
      GetActiveAgentsSchema,
      GetAgentSchema,
      GetPoolStatsSchema,
    ]);
  }

  protected async _run(input: ToolInput<this>) {
    let data: AgentRegistryToolResultData;
    switch (input.method) {
      case "getAvailableTools":
        data = this.registry.getAvailableTools(input.agentKind);
        break;
      case "registerAgentType":
        data = this.registry.registerAgentType(input.config);
        break;
      case "getAgentTypes":
        data = this.registry.getAgentTypes();
        break;
      case "getAgentTypeConfig":
        data = this.registry.getAgentTypeConfig(input.agentKind, input.type);
        break;
      case "acquireAgent":
        data = await this.registry.acquireAgent(input.agentKind, input.type);
        data = { ...data, instance: undefined };
        break;
      case "releaseAgent":
        data = await this.registry.releaseAgent(input.agentId);
        break;
      case "destroyAgent":
        data = await this.registry.destroyAgent(input.agentId);
        break;
      case "getActiveAgents":
        data = this.registry.getActiveAgents();
        break;
      case "getAgent":
        data = this.registry.getAgent(input.agentId);
        break;
      case "getPoolStats":
        data = this.registry.getPoolStats(input.agentKind, input.type);
        break;
    }
    return new JSONToolOutput({
      method: input.method,
      success: true,
      data,
    } satisfies AgentRegistryToolResult);
  }
}
