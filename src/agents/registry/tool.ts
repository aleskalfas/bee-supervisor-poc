import { Emitter } from "bee-agent-framework/emitter/emitter";
import {
  BaseToolOptions,
  JSONToolOutput,
  Tool,
  ToolEmitter,
  ToolInput,
} from "bee-agent-framework/tools/base";
import { isNonNullish } from "remeda";
import { z } from "zod";
import {
  Agent,
  AgentConfig,
  AgentConfigPoolStats,
  AgentConfigSchema,
  AgentKindEnumSchema,
  AvailableTool,
} from "./dto.js";
import { AgentInstanceRef, AgentRegistry } from "./registry.js";

export const TOOL_NAME = "agent_registry";
export interface AgentRegistryToolInput extends BaseToolOptions {
  registry: AgentRegistry<unknown>;
}

export type AgentRegistryToolResultData =
  | string[]
  | void
  | AgentConfig
  | string
  | Agent[]
  | AgentConfig[]
  | Agent
  | [AgentConfigPoolStats, [number, AgentConfigPoolStats][]]
  | AgentInstanceRef<unknown>
  | AvailableTool[];

export interface AgentRegistryToolResult {
  method: string;
  success: boolean;
  data: AgentRegistryToolResultData;
}

export const GetAvailableToolsSchema = z
  .object({
    method: z.literal("getAvailableTools"),
    agentKind: AgentKindEnumSchema.default(AgentKindEnumSchema.enum.operator).describe(
      "Kind of an agent.",
    ),
  })
  .describe(
    "Get all available tools usable in agents. Use this always before try to assign any tool.",
  );

export const CreateAgentConfigSchema = z
  .object({
    method: z.literal("createAgentConfig"),
    agentKind: z.literal(AgentKindEnumSchema.Enum.operator),
    config: AgentConfigSchema.omit({
      agentKind: true,
      agentConfigId: true,
      agentConfigVersion: true,
    }),
  })
  .describe("Create a new agent configuration.");

export const UpdateAgentConfigSchema = z
  .object({
    method: z.literal("updateAgentConfig"),
    agentKind: z.literal(AgentKindEnumSchema.Enum.operator),
    agentType: z.string(),
    config: AgentConfigSchema.partial().pick({
      instructions: true,
      description: true,
      tools: true,
      autoPopulatePool: true,
      maxPoolSize: true,
    }),
  })
  .describe("Update an existing agent configuration.");

export const GetAllAgentConfigsSchema = z
  .object({
    method: z.literal("getAllAgentConfigs"),
  })
  .describe("Get all registered agent configs");

export const GetAgentConfigSchema = z
  .object({
    method: z.literal("getAgentConfig"),
    agentKind: AgentKindEnumSchema,
    agentType: z.string(),
  })
  .describe("Get latest agent configuration for a specific agent kind and type");

export const GetAgentConfigVersionSchema = z
  .object({
    method: z.literal("getAgentConfigVersion"),
    agentKind: AgentKindEnumSchema,
    agentType: z.string(),
    version: z.number().optional().describe(`Not specified means last version`),
  })
  .describe("Get specific version of agent configuration");

export const GetActiveAgentsSchema = z
  .object({
    method: z.literal("getActiveAgents"),
    agentKind: AgentKindEnumSchema,
    agentType: z.string(),
    agentConfigVersion: z.number().optional().describe(`Not specified means any version`),
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
    agentKind: AgentKindEnumSchema,
    agentType: z.string(),
  })
  .describe(
    "Get statistics about the agent's pool for a specific agent configuration kind and type",
  );

/**
 * Tool for interacting with the AgentRegistry
 * Provides methods for managing agent types, instances, and pools
 */
export class AgentRegistryTool extends Tool<
  JSONToolOutput<AgentRegistryToolResult>,
  AgentRegistryToolInput
> {
  name = TOOL_NAME;
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
    const schemas = [
      ...(this.registry.switches.mutableAgentConfigs
        ? [
            GetAvailableToolsSchema,
            CreateAgentConfigSchema,
            UpdateAgentConfigSchema,
            GetPoolStatsSchema,
          ]
        : []),
      GetAllAgentConfigsSchema,
      GetAgentConfigSchema,
      GetAgentConfigVersionSchema,
      GetActiveAgentsSchema,
      GetAgentSchema,
    ]
      .flat()
      .filter(isNonNullish);
    return z.discriminatedUnion("method", schemas as any);
  }

  protected async _run(input: ToolInput<this>) {
    let data: AgentRegistryToolResultData;
    switch (input.method) {
      case "getAvailableTools":
        data = this.registry.getToolsFactory(input.agentKind || "operator").getAvailableTools();
        break;
      case "createAgentConfig":
        data = this.registry.createAgentConfig({ ...input.config, agentKind: input.agentKind });
        break;
      case "updateAgentConfig":
        data = this.registry.updateAgentConfig({
          ...input.config,
          agentKind: input.agentKind,
          agentType: input.agentType,
        });
        break;
      case "getAllAgentConfigs":
        data = this.registry.getAllAgentConfigs();
        break;
      case "getAgentConfig":
        data = this.registry.getAgentConfig(input.agentKind, input.agentType);
        break;
      case "getAgentConfigVersion":
        data = this.registry.getAgentConfig(input.agentKind, input.agentType, input.version);
        break;
      case "getActiveAgents":
        data = this.registry.getActiveAgents(
          input.agentKind,
          input.agentType,
          input.agentConfigVersion,
        );
        data = data.map((it) => ({ ...it, instance: undefined }));
        break;
      case "getAgent":
        data = this.registry.getAgent(input.agentId);
        data = { ...data, instance: undefined };
        break;
      case "getPoolStats":
        data = this.registry.getPoolStats(input.agentKind, input.agentType);
        break;
      default:
        throw new Error(`Undefined method ${input.method}`);
    }
    return new JSONToolOutput({
      method: input.method,
      success: true,
      data,
    } satisfies AgentRegistryToolResult);
  }
}
