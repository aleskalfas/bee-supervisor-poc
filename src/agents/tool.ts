import { Emitter } from "bee-agent-framework/emitter/emitter";
import {
  BaseToolOptions,
  JSONToolOutput,
  Tool,
  ToolEmitter,
  ToolInput,
} from "bee-agent-framework/tools/base";
import { z } from "zod";
import { AgentInstanceRef, AgentRegistry } from "./registry/registry.js";
import {
  Agent,
  AgentConfig,
  AgentConfigPoolStats,
  AgentConfigSchema,
  AgentKindEnumSchema,
  AvailableTool,
} from "./registry/dto.js";

export const TOOL_NAME = "agent_registry";

// Comprehensive manual to use the tool. Source of truth for TOOL_RULES
export const TOOL_MANUAL = `# Agent Registry System Manual

## Prerequisites

To work with Agent Registry, ensure that:
* Tools Factory is registered for your agent kind
* Required agent configurations are defined
* You understand the agent lifecycle phases
* You have necessary permissions for agent management

## Working Process

### Creating Agent Configuration

Agent configuration requires:
* **Agent Kind**
  * Must be either supervisor or operator
  * Defines the role and permissions level

* **Agent Type**
  * Must be unique identifier
  * Describes specific function or purpose

* **Instructions**
  * Detailed behavior step-by-step guidelines
  * Specific action protocols
  * Performance expectations 
  * Expected output format

* **Description**
  * Purpose of existence
  * Main responsibilities
  * Expected outcomes

* **Tools Access**
  * List of specific tools
  * Empty array for no tools

* **Pool Settings**
  * Maximum pool size
  * Auto population preferences

### Working with Tools

Before agent creation:
* Get available tools for the agent kind and decide which should be used.

### Understanding Pool System

Pool management follows these principles:
* Each agent type has dedicated pool
* Pool size is fixed by configuration
* System handles all lifecycle events
* Automatic agent acquisition/release

### Agent Lifecycle Phases

Automatic system management includes:
* Creation of new agents when needed
* Pool management and optimization
* Task-based agent acquisition
* Post-task agent release
* Cleanup of unused agents

### System Monitoring

Available monitoring capabilities:
* Active agent tracking
* Pool utilization statistics
* Configuration version control
* Tool usage analytics

## Key Considerations

### Pool Management

For optimal pool operation:
* Size pools based on workload
* Consider enabling auto-population
* Monitor utilization patterns
* Review resource allocation

### Version Control

Configuration versioning rules:
* All configurations are versioned
* New versions can be added
* Old versions remain accessible
* Version changes are tracked

### Resource Optimization

For best performance:
* Align pool sizes with needs
* Track resource consumption
* Monitor agent metrics
* Optimize tool distribution

## System Limitations

### Pool Constraints

Fixed limitations include:
* Maximum size per agent type
* Automatic lifecycle only
* No manual agent management
* Fixed pool boundaries

### Configuration Rules

Remember that:
* Tools require pre-registration
* Agent types are predefined
* Configurations are immutable
* Changes require new versions

## Best Practices

### Configuration Setup

When creating configurations:
* Write clear instructions
* Set realistic pool sizes
* Consider auto-population
* Define tool requirements

### Resource Management

For effective operation:
* Check pool utilization
* Monitor active agents
* Watch resource usage
* Review performance metrics

### Error Prevention

To minimize issues:
* Verify tool availability
* Validate configurations
* Monitor pool capacity
* Track error patterns

## Important Rules

Remember these key points:
* Configurations must exist before agents
* System manages all lifecycle events
* Monitor pools for health/utilization
* Track tools and configurations
* Regular performance review needed`;

// Distilled manual for system prompt
export const TOOL_RULES = `# Agent Registry Rules

You are working with an Agent Registry system. Follow these rules:

1. Before requesting any agent operations, ensure a valid agent configuration exists that specifies:
   * Agent Kind (supervisor/operator)
   * Agent Type (unique identifier)
   * Instructions for behavior
   * Tools access settings
   * Pool configuration

2. Understand that agents are managed automatically:
   * You cannot create or destroy agents directly
   * Agents are acquired automatically when tasks start
   * Agents are released automatically when tasks complete
   * Pool sizes are fixed by configuration

3. When working with tools:
   * Only use tools registered for your agent kind
   * Verify tool availability before tasks
   * Null means all tools available
   * Empty array means no tools allowed
   * Agents doesn't need tools for llm capabilities

4. For monitoring:
   * Track active agents in your tasks
   * Check pool statistics when needed
   * Monitor tool availability
   * Report any issues encountered

5. Remember:
   * Always check configurations before tasks
   * Let the system handle agent lifecycle
   * Work within pool size limits
   * Use only available tools`;

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
    agentKind: AgentKindEnumSchema.describe("Kind of agent is mandatory."),
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
    return z.discriminatedUnion("method", [
      GetAvailableToolsSchema,
      CreateAgentConfigSchema,
      UpdateAgentConfigSchema,
      GetAllAgentConfigsSchema,
      GetAgentConfigSchema,
      GetAgentConfigVersionSchema,
      GetActiveAgentsSchema,
      GetAgentSchema,
      GetPoolStatsSchema,
    ]);
  }

  protected async _run(input: ToolInput<this>) {
    let data: AgentRegistryToolResultData;
    switch (input.method) {
      case "getAvailableTools":
        data = this.registry.getToolsFactory(input.agentKind).getAvailableTools();
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
    }
    return new JSONToolOutput({
      method: input.method,
      success: true,
      data,
    } satisfies AgentRegistryToolResult);
  }
}
