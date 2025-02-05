import { Logger } from "bee-agent-framework/logger/logger";
import { BaseToolsFactory } from "src/base/tools-factory.js";
import { z } from "zod";

export const AgentKindSchema = z
  .enum(["supervisor", "operator"])
  .describe(
    "Specifies the role type of an agent in the system. A 'supervisor' has administrative privileges and can oversee multiple operators, while an 'operator' handles day-to-day operational tasks.",
  );
export type AgentKind = z.infer<typeof AgentKindSchema>;

/**
 * Schema for configuring an agent type.
 * Defines the basic properties and requirements for creating agents of a specific type.
 */
export const AgentConfigSchema = z.object({
  kind: AgentKindSchema,
  type: z.string().describe("Unique identifier for the agent type"),
  instructions: z.string().describe("Provide detailed instructions on how the agent should act."),
  description: z
    .string()
    .describe("Description of the agent's behavior and purpose of his existence."),
  tools: z
    .array(z.string())
    .nullish()
    .describe(
      "List of tool identifiers that this agent type can utilize. Null/undefined means all available.",
    ),
  maxPoolSize: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Maximum number of agents to maintain in the pool for this type."),
  autoPopulatePool: z
    .boolean()
    .default(false)
    .describe("Populates the agent pool for a specific type up to its configured size."),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

/**
 * Schema for an individual agent instance.
 * Represents a specific instance of an agent with its runtime state.
 */
export const AgentSchema = z.object({
  /** Unique identifier for this specific agent instance */
  id: z.string(),
  /** The type of agent this instance represents */
  type: z.string(),
  kind: AgentKindSchema,
  /** Configuration settings for this agent */
  config: AgentConfigSchema,
  /**
   * Indicates whether this agent is currently being used
   * Used for pool management to track available agents
   */
  inUse: z.boolean().default(false),
  instance: z.any(),
});
export type Agent = z.infer<typeof AgentSchema>;

/**
 * Schema for an available tool.
 */
export const AvailableToolSchema = z.object({
  name: z.string(),
  description: z.string(),
});

export type AvailableTool = z.infer<typeof AvailableToolSchema>;

/**
 * Schema for pool statistics of an agent type
 * Provides information about pool capacity and utilization
 */
export const PoolStatsSchema = z
  .object({
    /** Maximum number of agents that can be in the pool */
    poolSize: z.number(),
    /** Number of agents currently available in the pool */
    available: z.number(),
    /** Number of agents currently in use from the pool */
    inUse: z.number(),
    /** Number of created agents */
    created: z.number(),
  })
  .describe("Statistics about an agent type's pool");

export type PoolStats = z.infer<typeof PoolStatsSchema>;

/**
 * Callbacks for managing agent lifecycle events.
 * These callbacks allow customization of agent behavior at key points in their lifecycle.
 */
export interface AgentLifecycleCallbacks<TAgentInstance> {
  /**
   * Called when a new agent needs to be created
   * @param config - Configuration for the agent
   * @param poolStats - Statistics of the agent pool
   * @param toolsFactory - Factory to create tools
   * @returns Promise resolving to the new agent's ID
   */
  onCreate: (
    config: AgentConfig,
    poolStats: PoolStats,
    toolsFactory: BaseToolsFactory,
  ) => Promise<{ id: string; instance: TAgentInstance }>;

  /**
   * Called when an agent is being destroyed
   * @param instance - Instance of the agent being destroyed
   */
  onDestroy: (instance: TAgentInstance) => Promise<void>;

  /**
   * Optional callback when an agent is acquired from the pool
   * Use this to prepare an agent for reuse
   * @param agentId - ID of the agent being acquired
   */
  onAcquire?: (agentId: string) => Promise<TAgentInstance>;

  /**
   * Optional callback when an agent is released back to the pool
   * Use this to clean up agent state before returning to pool
   * @param agentId - ID of the agent being released
   */
  onRelease?: (agentId: string) => Promise<void>;
}

type AgentTypePoolMap = Map<string, Set<string>>;
type AgentConfigMap = Map<string, AgentConfig>;
export interface AgentInstanceRef<TInstance> {
  agentId: string;
  instance: TInstance;
}

function ref<TAgentInstance>(
  agentId: string,
  instance: TAgentInstance,
): AgentInstanceRef<TAgentInstance> {
  return { agentId, instance };
}

/**
 * Registry for managing agent types, instances, and pools.
 * Provides functionality for:
 * - Registering and managing agent types
 * - Creating and destroying agent instances
 * - Managing pools of reusable agents
 * - Tracking agent lifecycle and utilization
 *
 * Usage:
 * - Whenever you need an agent first look if there already is an suitable agent type if not let register new one.
 *
 */
export class AgentRegistry<TAgentInstance> {
  private readonly logger: Logger;
  /** Map of registered agent kind and their configurations */
  private agentConfigs: Map<AgentKind, AgentConfigMap>;
  /** Map of all active agent instances */
  private activeAgents = new Map<string, Agent>();
  /** Map of agent pools by kind and type, containing sets of available agent IDs */
  private agentPools: Map<AgentKind, AgentTypePoolMap>;
  /** Map of agent instances available by agent IDs */
  private agentInstances = new Map<string, TAgentInstance>();
  /** Callbacks for agent lifecycle events */
  private callbacks: AgentLifecycleCallbacks<TAgentInstance>;
  /** Maps of tools factories for use by agents per agent kinds */
  private toolsFactory = new Map<AgentKind, BaseToolsFactory>();

  /**
   * Creates a new AgentRegistry instance
   * @param callbacks - Callbacks for handling agent lifecycle events
   */
  constructor(callbacks: AgentLifecycleCallbacks<TAgentInstance>) {
    this.logger = Logger.root.child({ name: "AgentRegistry" });
    this.logger.info("Initializing AgentRegistry");
    this.callbacks = callbacks;
    // Initialize agent pools for all agent kinds
    this.agentConfigs = new Map(AgentKindSchema.options.map((kind) => [kind, new Map()]));
    this.agentPools = new Map(AgentKindSchema.options.map((kind) => [kind, new Map()]));
  }

  /**
   * Register tools factory for a specific agent type
   * @param tuples
   */
  registerToolsFactories(tuples: [AgentKind, BaseToolsFactory][]) {
    tuples.map(([kind, factory]) => this.toolsFactory.set(kind, factory));
  }

  private getAgentKindPoolMap(kind: AgentKind) {
    const poolKind = this.agentPools.get(kind);
    if (!poolKind) {
      throw new Error(`There is missing pool for agent kind:${kind}`);
    }
    return poolKind;
  }

  private getAgentPoolMap(kind: AgentKind, type: string) {
    const poolKind = this.getAgentKindPoolMap(kind);
    const pool = poolKind.get(type);
    if (!poolKind) {
      throw new Error(`There is missing pool for agent kind:${kind} type:${type}`);
    }
    return pool;
  }

  private getAgentConfigMap(kind: AgentKind) {
    const typesMap = this.agentConfigs.get(kind);
    if (!typesMap) {
      throw new Error(`There is missing types map for agent kind:${kind}`);
    }
    return typesMap;
  }

  getToolsFactory(agentKind: AgentKind): BaseToolsFactory {
    const factory = this.toolsFactory.get(agentKind);
    if (!factory) {
      this.logger.error(`There is missing tools factory for the '${agentKind}' agent kind.`, {
        agentKind,
      });
      throw new Error(`There is missing tools factory for the '${agentKind}' agent kind`);
    }

    return factory;
  }

  /**
   * Registers a new agent type with the registry
   * If the agent type has a pool size > 0, initializes and populates the pool
   * @param config - Configuration for the new agent type
   * @throws Error if agent type is already registered
   */
  registerAgentType(config: AgentConfig): void {
    const { kind, type, maxPoolSize, autoPopulatePool } = config;
    this.logger.info("Registering new agent type", {
      kind: kind,
      type: type,
      poolSize: maxPoolSize,
    });

    const agentTypesMap = this.getAgentConfigMap(kind);
    if (agentTypesMap.has(type)) {
      this.logger.error("Agent type already registered", { type: type });
      throw new Error(`Agent type '${type}' is already registered`);
    }

    const toolsFactory = this.getToolsFactory(config.kind);
    const availableTools = toolsFactory.getAvailableTools();
    if (config.tools) {
      const undefinedTools = config.tools.filter(
        (tool) => !availableTools.some((at) => at.name === tool),
      );
      if (undefinedTools.length) {
        this.logger.error(`Tool wasn't found between available tools `, {
          availableTools: availableTools.map((at) => at.name),
          undefinedTools,
        });
        throw new Error(
          `Tools [${undefinedTools.join(",")}] weren't found between available tools [${availableTools.map((at) => at.name).join(",")}]`,
        );
      }
    } else {
      config.tools = toolsFactory.getAvailableToolsNames();
    }

    agentTypesMap.set(type, config);

    // Initialize pool if pooling is enabled
    if (maxPoolSize > 0) {
      this.logger.debug("Initializing agent pool", {
        kind,
        type,
        poolSize: maxPoolSize,
      });

      const kindPool = this.getAgentKindPoolMap(kind);
      kindPool.set(type, new Set([]));

      if (autoPopulatePool) {
        // Pre-populate pool
        this.populatePool(kind, type).catch((error) => {
          this.logger.error("Failed to populate pool", { type: type, error });
        });
      }
    }
  }

  /**
   * Populates the agent pool for a specific type up to its configured size
   * @param type - The agent type to populate pool for
   * @private
   */
  private async populatePool(kind: AgentKind, type: string): Promise<void> {
    this.logger.debug("Populating agent pool", { type });
    const config = this.getAgentTypeConfig(kind, type);
    const pool = this.getAgentPoolMap(kind, type);

    if (!pool || config.maxPoolSize <= 0) {
      this.logger.trace("Pool population skipped - no pool or size 0", { type });
      return;
    }

    const currentPoolSize = pool.size;
    const needed = config.maxPoolSize - currentPoolSize;

    this.logger.debug("Creating agents for pool", {
      type,
      needed,
      currentPoolSize,
      targetSize: config.maxPoolSize,
    });

    for (let i = 0; i < needed; i++) {
      const { agentId: agentId } = await this.createAgent(kind, type, true);
      pool.add(agentId);
      this.logger.trace("Added agent to pool", { kind, type, agentId });
    }
  }

  /**
   * Returns list of all registered agent types
   * @returns Array of agent type identifiers
   */
  getAgentTypes(): string[] {
    this.logger.trace("Getting registered agent types");
    return Array.from(this.agentConfigs.keys());
  }

  /**
   * Retrieves configuration for a specific agent type
   * @param kind - The agent kind to get configuration for
   * @param type - The agent type to get configuration for
   * @returns Configuration for the specified agent type
   * @throws Error if agent type is not registered
   */
  getAgentTypeConfig(kind: AgentKind, type: string): AgentConfig {
    this.logger.trace("Getting agent type configuration", { type });
    const config = this.getAgentConfigMap(kind).get(type);
    if (!config) {
      this.logger.error("Agent type not found", { type });
      throw new Error(`Agent type '${type}' not found`);
    }
    return config;
  }

  /**
   * Acquires an agent instance from the pool or creates a new one
   * @param kind - The kind of agent to acquire
   * @param type - The type of agent to acquire
   * @returns Promise resolving to the agent ID
   * @throws Error if no agents are available and pool is at capacity
   */
  async acquireAgent(kind: AgentKind, type: string): Promise<AgentInstanceRef<TAgentInstance>> {
    this.logger.debug("Attempting to acquire agent", { type });
    const config = this.getAgentTypeConfig(kind, type);
    const pool = this.getAgentPoolMap(kind, type);

    if (!pool || config.maxPoolSize === 0) {
      this.logger.debug("No pool available, creating new agent", { type });
      return this.createAgent(kind, type, false);
    }

    // Try to get an available agent from the pool
    for (const agentId of pool) {
      const agent = this.activeAgents.get(agentId);
      if (agent && !agent.inUse) {
        pool.delete(agentId);
        agent.inUse = true;

        this.logger.debug("Acquired agent from pool", { type, agentId });

        if (this.callbacks.onAcquire) {
          this.logger.trace("Executing onAcquire callback", { agentId });
          await this.callbacks.onAcquire(agentId);
        }

        return ref(agentId, agent.instance);
      }
    }

    // No available agents in pool
    if (pool.size < config.maxPoolSize) {
      this.logger.debug("Pool not at capacity, creating new agent", {
        kind,
        type,
        currentSize: pool.size,
        maxSize: config.maxPoolSize,
      });
      return this.createAgent(kind, type, false);
    }

    this.logger.error("No available agents and pool at capacity", {
      type,
      poolSize: config.maxPoolSize,
    });
    throw new Error(`No available agents of type '${type}' in pool and pool is at capacity`);
  }

  /**
   * Releases an agent back to its pool or destroys it
   * @param agentId - ID of the agent to release
   * @throws Error if agent is not found
   */
  async releaseAgent(agentId: string): Promise<void> {
    this.logger.debug("Attempting to release agent", { agentId });
    const agent = this.activeAgents.get(agentId);
    if (!agent) {
      this.logger.error("Agent not found for release", { agentId });
      throw new Error(`Agent with ID '${agentId}' not found`);
    }

    const { kind, type, maxPoolSize } = this.getAgentTypeConfig(agent.kind, agent.type);
    const pool = this.getAgentPoolMap(kind, type);

    if (!pool || maxPoolSize === 0) {
      this.logger.debug("No pool available, destroying agent", { agentId });
      await this.destroyAgent(agentId);
      return;
    }

    if (this.callbacks.onRelease) {
      this.logger.trace("Executing onRelease callback", { agentId });
      await this.callbacks.onRelease(agentId);
    }

    // Return to pool
    agent.inUse = false;
    pool.add(agentId);
    this.logger.debug("Agent released back to pool", { agentId, type: agent.type });
  }

  /**
   * Creates a new agent instance
   * @param type - The type of agent to create
   * @param forPool - Whether this agent is being created for a pool
   * @returns Promise resolving to the new agent's ID
   * @private
   */
  private async createAgent(
    kind: AgentKind,
    type: string,
    forPool: boolean,
  ): Promise<AgentInstanceRef<TAgentInstance>> {
    this.logger.debug("Creating new agent", { kind, type, forPool });
    const config = this.getAgentTypeConfig(kind, type);
    const poolStats = this.getPoolStats(kind, type);
    const toolsFactory = this.getToolsFactory(kind);
    const { id: agentId, instance } = await this.callbacks.onCreate(
      config,
      poolStats,
      toolsFactory,
    );

    this.activeAgents.set(agentId, {
      id: agentId,
      kind,
      type,
      config,
      inUse: !forPool,
      instance,
    });

    this.logger.info("Agent created successfully", { agentId, type, forPool });
    return ref(agentId, instance);
  }

  /**
   * Destroys an existing agent instance
   * @param agentId - ID of the agent to destroy
   * @throws Error if agent is not found
   */
  async destroyAgent(agentId: string): Promise<void> {
    this.logger.debug("Attempting to destroy agent", { agentId });
    const agent = this.activeAgents.get(agentId);
    if (!agent) {
      this.logger.error("Agent not found for destruction", { agentId });
      throw new Error(`Agent with ID '${agentId}' not found`);
    }

    // Remove from pool if it's in one
    const pool = this.getAgentPoolMap(agent.kind, agent.type);
    if (pool) {
      pool.delete(agentId);
      this.logger.trace("Removed agent from pool", { agentId, kind: agent.kind, type: agent.type });
    }

    await this.callbacks.onDestroy(agent.instance);
    this.activeAgents.delete(agentId);
    this.logger.info("Agent destroyed successfully", {
      agentId,
      kind: agent.kind,
      type: agent.type,
    });
  }

  /**
   * Returns list of all active agent instances
   * @returns Array of active agents
   */
  getActiveAgents(): Agent[] {
    this.logger.trace("Getting active agents");
    return Array.from(this.activeAgents.values());
  }

  /**
   * Retrieves a specific agent instance by ID
   * @param agentId - ID of the agent to retrieve
   * @returns The requested agent instance
   * @throws Error if agent is not found
   */
  getAgent(agentId: string): Agent {
    this.logger.trace("Getting agent by ID", { agentId });
    const agent = this.activeAgents.get(agentId);
    if (!agent) {
      this.logger.error("Agent not found", { agentId });
      throw new Error(`Agent with ID '${agentId}' not found`);
    }
    return agent;
  }

  /**
   * Returns statistics about the agent pool for a specific type
   * @param type - The agent type to get pool statistics for
   * @returns Object containing pool statistics
   */
  getPoolStats(kind: AgentKind, type: string): PoolStats {
    this.logger.trace("Getting pool statistics", { type });
    const config = this.getAgentTypeConfig(kind, type);
    const pool = this.getAgentPoolMap(kind, type);

    if (!pool || config.maxPoolSize === 0) {
      return { poolSize: 0, available: 0, inUse: 0, created: 0 };
    }

    const available = Array.from(pool).filter(
      (agentId) => !this.activeAgents.get(agentId)?.inUse,
    ).length;

    const stats = {
      poolSize: config.maxPoolSize,
      available,
      inUse: pool.size - available,
      created: pool.size,
    };

    this.logger.debug("Pool statistics", { type, ...stats });
    return stats;
  }
}
