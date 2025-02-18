import { Logger } from "bee-agent-framework/logger/logger";
import { clone, isNonNullish } from "remeda";
import { BaseToolsFactory } from "src/base/tools-factory.js";
import { updateDeepPartialObject } from "src/utils/objects.js";
import {
  agentConfigIdToValue,
  agentIdToString,
  agentSomeIdToKindValue,
  agentSomeIdToTypeValue,
  stringToAgentConfig,
} from "../agent-id.js";
import { agentStateLogger } from "../state/logger.js";
import {
  Agent,
  AgentConfig,
  AgentConfigIdValue,
  AgentConfigPoolStats,
  AgentConfigVersionValue,
  AgentIdValue,
  AgentKindEnum,
  AgentKindEnumSchema,
  AgentTypeValue,
  AgentWithInstance,
} from "./dto.js";

/**
 * Callbacks for managing agent lifecycle events.
 * These callbacks allow customization of agent behavior at key points in their lifecycle.
 */
export interface AgentLifecycleCallbacks<TAgentInstance> {
  /**
   * Called when a new agent needs to be created
   * @param config - Configuration for the agent
   * @param agentId - Unique agent ID
   * @param poolStats - Statistics of the agent pool
   * @param toolsFactory - Factory to create tools
   * @returns Promise resolving to the new agent's id and instance
   */
  onCreate: (
    config: AgentConfig,
    agentId: AgentIdValue,
    toolsFactory: BaseToolsFactory,
  ) => Promise<{ agentId: AgentIdValue; instance: TAgentInstance }>;

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
  onAcquire?: (agentId: AgentIdValue) => Promise<TAgentInstance>;

  /**
   * Optional callback when an agent is released back to the pool
   * Use this to clean up agent state before returning to pool
   * @param agentId - ID of the agent being released
   */
  onRelease?: (agentId: AgentIdValue) => Promise<void>;
}

type AgentRuntime<TInstance> = Agent & { instance: TInstance };

export interface AgentInstanceRef<TInstance> {
  agentId: AgentIdValue;
  instance: TInstance;
}

export type AgentTypesMap = Map<AgentKindEnum, Set<string>>;

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
  private agentConfigs: Map<AgentKindEnum, Map<AgentTypeValue, AgentConfig[]>>;
  /** Map of all agent instances */
  private agents = new Map<AgentIdValue, AgentRuntime<TAgentInstance>>();
  /** Map of agent pools by kind and type, containing sets of available agent IDs */
  private agentPools: Map<
    AgentKindEnum,
    Map<AgentTypeValue, [AgentConfigVersionValue, Set<AgentConfigIdValue>][]>
  >;
  /** Callbacks for agent lifecycle events */
  private lifecycleCallbacks: AgentLifecycleCallbacks<TAgentInstance>;
  private onAgentConfigCreated: (agentKind: AgentKindEnum, agentType: AgentTypeValue) => void;
  /** Maps of tools factories for use by agents per agent kinds */
  private toolsFactory = new Map<AgentKindEnum, BaseToolsFactory>();
  private poolsCleanupJobIntervalId: NodeJS.Timeout | null = null;
  private poolsCleanupJobExecuting = false;
  private poolsToCleanup: string[] = [];

  /**
   * Creates a new AgentRegistry instance
   * @param callbacks - Callbacks for handling agent lifecycle events and agent type registration
   */
  constructor({
    agentLifecycle,
    onAgentConfigCreated,
  }: {
    onAgentConfigCreated: (agentKind: AgentKindEnum, agentType: string) => void;
    agentLifecycle: AgentLifecycleCallbacks<TAgentInstance>;
  }) {
    this.logger = Logger.root.child({ name: "AgentRegistry" });
    this.logger.info("Initializing AgentRegistry");
    this.lifecycleCallbacks = agentLifecycle;
    this.onAgentConfigCreated = onAgentConfigCreated;
    // Initialize agent pools for all agent kinds
    this.agentConfigs = new Map(AgentKindEnumSchema.options.map((kind) => [kind, new Map()]));
    this.agentPools = new Map(AgentKindEnumSchema.options.map((kind) => [kind, new Map()]));
  }

  /**
   * Register tools factory for a specific agent type
   * @param tuples
   */
  registerToolsFactories(tuples: [AgentKindEnum, BaseToolsFactory][]) {
    tuples.map(([agentKind, factory]) => {
      this.toolsFactory.set(agentKind, factory);
      agentStateLogger().logAvailableTools({
        agentKindId: agentSomeIdToKindValue({ agentKind }),
        availableTools: factory.getAvailableTools(),
      });
    });
  }

  private getAgentKindPoolMap(agentKind: AgentKindEnum) {
    const poolKind = this.agentPools.get(agentKind);
    if (!poolKind) {
      throw new Error(`There is missing pool for agent agentKind:${agentKind}`);
    }
    return poolKind;
  }

  private getAgentTypeVersionSetsArray(agentKind: AgentKindEnum, agentType: AgentTypeValue) {
    const poolKind = this.getAgentKindPoolMap(agentKind);
    const pool = poolKind.get(agentType);
    if (!pool) {
      throw new Error(
        `There is missing pool version sets array for agent agentKind:${agentKind} agentType:${agentType}`,
      );
    }
    return pool;
  }

  private getAgentTypeVersionSet(
    agentKind: AgentKindEnum,
    agentType: AgentTypeValue,
    agentConfigVersion: number,
  ) {
    const poolVersionSetsArray = this.getAgentTypeVersionSetsArray(agentKind, agentType);
    const poolVersionSet = poolVersionSetsArray.find((it) => it[0] === agentConfigVersion);
    if (!poolVersionSet) {
      throw new Error(
        `There is missing pool version set for agent agentKind:${agentKind} agentType:${agentType} version:${agentConfigVersion}`,
      );
    }
    return poolVersionSet[1];
  }

  private getAgentConfigMap(agentKind: AgentKindEnum) {
    const typesMap = this.agentConfigs.get(agentKind);
    if (!typesMap) {
      throw new Error(`There is missing types map for agent agentKind:${agentKind}`);
    }
    return typesMap;
  }

  private getAgentConfigTypeMap(agentKind: AgentKindEnum, agentType: string) {
    const agentConfigTypeMap = this.getAgentConfigMap(agentKind);
    const agentVersions = agentConfigTypeMap.get(agentType);
    if (!agentVersions) {
      this.logger.error("Agent config type map was not found", { agentKind, agentType });
      throw new Error(`Agent kind '${agentKind}' type '${agentType}' was not found`);
    }
    return agentVersions;
  }

  getToolsFactory(agentKind: AgentKindEnum): BaseToolsFactory {
    const factory = this.toolsFactory.get(agentKind);
    if (!factory) {
      this.logger.error(`There is missing tools factory for the '${agentKind}' agent kind.`, {
        agentKind,
      });
      throw new Error(`There is missing tools factory for the '${agentKind}' agent kind`);
    }

    return factory;
  }

  createAgentConfig(
    config: Omit<AgentConfig, "agentConfigVersion" | "agentConfigId">,
  ): AgentConfig {
    const { agentKind, agentType, maxPoolSize } = config;
    this.logger.info("Create new agent config", {
      agentKind,
      agentType,
      maxPoolSize,
    });

    const agentTypesMap = this.getAgentConfigMap(agentKind);
    if (agentTypesMap.has(agentType)) {
      this.logger.error("Agent type already registered", { agentType });
      throw new Error(`Agent type '${agentType}' is already registered`);
    }

    const toolsFactory = this.getToolsFactory(config.agentKind);
    const availableTools = toolsFactory.getAvailableTools();
    if (config.tools.filter((it) => !!it.length).length) {
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
      config.tools = [];
    }

    const agentConfigVersion = 1;
    const agentConfigId = agentConfigIdToValue({
      ...config,
      agentConfigVersion,
    });
    const configVersioned = { ...config, agentConfigId, agentConfigVersion };
    agentTypesMap.set(agentType, [configVersioned]);
    agentStateLogger().logAgentConfigCreate({
      agentConfigId,
      agentType: agentSomeIdToTypeValue(configVersioned),
      config: configVersioned,
    });

    this.initializeAgentPool(agentKind, agentType, agentConfigVersion);
    this.onAgentConfigCreated(agentKind, agentType);

    return configVersioned;
  }

  updateAgentConfig(
    update: Pick<AgentConfig, "agentKind" | "agentType"> &
      Partial<
        Pick<
          AgentConfig,
          "tools" | "instructions" | "description" | "maxPoolSize" | "autoPopulatePool"
        >
      >,
  ) {
    const { agentKind, agentType } = update;
    const config = this.getAgentConfig(update.agentKind, update.agentType);

    if (update.tools) {
      // Check tools existence
      const toolsFactory = this.getToolsFactory(config.agentKind);
      const availableTools = toolsFactory.getAvailableTools();
      const undefinedTools = update.tools.filter(
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
    }

    const newConfigVersion = clone(config);

    const agentConfigVersion = config.agentConfigVersion + 1;
    const agentConfigId = agentConfigIdToValue({
      ...config,
      agentConfigVersion: agentConfigVersion,
    });
    updateDeepPartialObject(newConfigVersion, {
      ...update,
      agentConfigId,
      agentConfigVersion,
    });
    const configVersions = this.getAgentConfigTypeMap(agentKind, agentType);
    configVersions.push(newConfigVersion);

    this.initializeAgentPool(agentKind, agentType, agentConfigVersion);
    this.lookupPoolsToClean();

    agentStateLogger().logAgentConfigUpdate({
      agentType: agentSomeIdToTypeValue(newConfigVersion),
      agentConfigId: newConfigVersion.agentConfigId,
      config: newConfigVersion,
    });

    return newConfigVersion;
  }

  private initializeAgentPool(
    agentKind: AgentKindEnum,
    agentType: AgentTypeValue,
    version: number,
  ) {
    this.logger.debug("Initializing agent pool", {
      agentKind,
      agentType,
      version,
    });

    const kindPool = this.getAgentKindPoolMap(agentKind);
    let typePool = kindPool.get(agentType);
    if (!typePool) {
      typePool = [];
      kindPool.set(agentType, typePool);
    }
    typePool.push([version, new Set([])]);

    this.populatePool(agentKind, agentType, version).catch((error) => {
      this.logger.error("Failed to populate pool", { agentType, error });
    });
  }

  /**
   * Populates the agent pool for a specific type up to its configured size
   * @param agentKind - The agent kind to populate pool for
   * @param agentType - The agent type to populate pool for
   * @param version - The agent version to populate pool for
   * @private
   */
  private async populatePool(
    agentKind: AgentKindEnum,
    agentType: AgentTypeValue,
    version: number,
  ): Promise<void> {
    this.logger.debug("Populating agent pool", { agentKind, agentType, version });
    const config = this.getAgentConfig(agentKind, agentType, version);

    if (config.maxPoolSize <= 0) {
      this.logger.trace("Pool population skipped - no pool or size 0", { agentType });
      return;
    }

    const pool = this.getAgentTypeVersionSet(agentKind, agentType, version);
    if (config.autoPopulatePool) {
      // Pre-populate pool
      const currentPoolSize = pool.size;
      const needed = config.maxPoolSize - currentPoolSize;

      this.logger.debug("Creating agents for pool", {
        agentType,
        needed,
        currentPoolSize,
        targetSize: config.maxPoolSize,
      });

      for (let i = 0; i < needed; i++) {
        await this.createAgent(agentKind, agentType, version);
      }
    }
  }

  private lookupPoolsToClean() {
    this.logger.trace("Looking up pools to cleanup");
    this.poolsToCleanup.splice(0);
    // Traverse through all pools and try to destroy all unused agents
    Array.from(this.agentPools.entries()).forEach(([agentKind, typeMap]) => {
      Array.from(typeMap.entries()).forEach(([agentType, versions]) => {
        versions.forEach(([version], index, set) => {
          const latestVersion = index + 1 >= set.length;
          // Schedule
          if (!latestVersion) {
            this.poolsToCleanup.push(
              agentConfigIdToValue({ agentKind, agentType, agentConfigVersion: version }),
            );
          }
        });
      });
    });

    if (this.poolsToCleanup.length) {
      this.startPoolsCleanupJob();
    }
  }

  private startPoolsCleanupJob() {
    this.logger.trace("Start cleanup job");
    if (this.poolsCleanupJobIntervalId != null) {
      this.logger.warn(`Pool cleanup job is already running`);
    }
    this.poolsCleanupJobIntervalId = setInterval(async () => {
      if (!this.poolsCleanupJobExecuting) {
        this.poolsCleanupJobExecuting = true;
        this.executePoolsCleanup().catch((err) => {
          this.logger.error("Execute pool cleanup job error", err);
          this.stopPoolsCleanupJob();
        });
      }
    }, 1000); // Runs every 1s
  }

  private async executePoolsCleanup() {
    this.logger.trace("Executing pool cleanup");
    const poolsToCleanupClone = clone(this.poolsToCleanup);

    let isCleaned = true;
    let index = 0;
    for (const agentConfigIdStr of poolsToCleanupClone) {
      const agentConfigId = stringToAgentConfig(agentConfigIdStr);
      const agentTypeVersionPoolSet = this.getAgentTypeVersionSet(
        agentConfigId.agentKind,
        agentConfigId.agentType,
        agentConfigId.agentConfigVersion,
      );

      let destroyed = 0;
      for (const agentId of agentTypeVersionPoolSet.values()) {
        const agent = this.getAgent(agentId);
        if (!agent.inUse) {
          try {
            await this.destroyAgent(agent.agentId);
            destroyed++;
          } catch (err) {
            this.logger.error(`Cleanup error for agent '${agent.agentId}'`, err);
          }
        } else {
          this.logger.warn(`Can't cleanup agent '${agent.agentId}' he is in use`);
        }
      }
      if (destroyed < agentTypeVersionPoolSet.size) {
        isCleaned = false;
      } else {
        // Destroy unused agent config
        this.destroyAgentConfig(
          agentConfigId.agentKind,
          agentConfigId.agentType,
          agentConfigId.agentConfigVersion,
        );
        this.poolsToCleanup.splice(index, 1);
      }
      index++;
    }

    if (isCleaned) {
      this.stopPoolsCleanupJob();
    }
  }

  private stopPoolsCleanupJob() {
    this.logger.debug("Stop cleanup job");
    if (this.poolsCleanupJobIntervalId == null) {
      this.logger.warn(`Pool cleanup job is already stopped`);
    } else {
      clearInterval(this.poolsCleanupJobIntervalId);
      this.poolsCleanupJobIntervalId = null;
    }
  }

  /**
   * Returns list of all registered agent configs
   * @returns Array of agent type identifiers
   */
  getAllAgentConfigs(): AgentConfig[] {
    this.logger.trace("Getting registered agent configs");
    return Array.from(this.agentConfigs.entries())
      .map(([, typeMap]) =>
        Array.from(typeMap.entries())
          .map(([, versions]) => versions.at(-1))
          .filter(isNonNullish),
      )
      .flat();
  }

  getAgentConfig(
    agentKind: AgentKindEnum,
    agentType: AgentTypeValue,
    agentConfigVersion?: number,
  ): AgentConfig {
    this.logger.trace("Getting agent type configuration", {
      agentKind,
      agentType,
      agentConfigVersion,
    });
    const configVersions = this.getAgentConfigMap(agentKind).get(agentType);
    if (!configVersions) {
      this.logger.error("Agent config not found", { agentType: agentType });
      throw new Error(`Agent kind '${agentKind}' type '${agentType}' was not found`);
    }
    if (agentConfigVersion != null) {
      const configVersion = configVersions.find((c) => c.agentConfigVersion === agentConfigVersion);
      if (!configVersion) {
        throw new Error(
          `Agent kind '${agentKind}' type '${agentType}' version '${agentConfigVersion}' was not found`,
        );
      }
      return configVersion;
    }

    const lastConfigVersion = configVersions.at(-1);
    if (lastConfigVersion == null) {
      throw new Error(`Agent kind '${agentKind}' type '${agentType}' last version was not found`);
    }
    return lastConfigVersion;
  }

  private destroyAgentConfig(
    agentKind: AgentKindEnum,
    agentType: AgentTypeValue,
    agentConfigVersion: number,
  ): AgentConfig {
    this.logger.trace("Destroying agent configuration", {
      agentKind,
      agentType,
      version: agentConfigVersion,
    });
    const configVersions = this.getAgentConfigMap(agentKind).get(agentType);
    if (!configVersions) {
      this.logger.error("Agent config versions was not found", { agentType: agentType });
      throw new Error(
        `Agent kind '${agentKind}' type '${agentType}' config versions was not found`,
      );
    }

    const configVersionAt = configVersions.findIndex(
      (c) => c.agentConfigVersion === agentConfigVersion,
    );
    if (configVersionAt < 0) {
      throw new Error(
        `Agent kind '${agentKind}' type '${agentType}' version '${agentConfigVersion}' was not found`,
      );
    }
    const stats = this.getPoolStatsByVersion(agentKind, agentType, agentConfigVersion);
    if (stats.active) {
      throw new Error(
        `Agent config kind '${agentKind}' type '${agentType}' version '${agentConfigVersion}' can't be destroyed while it is still in use.`,
      );
    }

    const destroyedConfig = configVersions.splice(configVersionAt, 1)[0];
    const { agentConfigId } = destroyedConfig;
    this.logger.info("Agent config destroyed successfully", {
      agentConfigId,
      agentKind,
      agentType,
      version: agentConfigVersion,
    });

    if (!configVersions.length) {
      this.getAgentConfigMap(agentKind).delete(agentType);
    }

    if (!this.getAgentConfigMap(agentKind).size) {
      this.agentConfigs.delete(agentKind);
    }

    const agentTypeId = agentSomeIdToTypeValue({
      agentKind,
      agentType,
    });
    agentStateLogger().logAgentConfigDestroy({
      agentConfigId,
      agentType: agentTypeId,
    });
    return destroyedConfig;
  }

  /**
   * Acquires an agent instance from the pool or creates a new one
   * @param agentKind - The kind of agent to acquire
   * @param agentType - The type of agent to acquire
   * @param version - The version of agent to acquire
   * @returns Promise resolving to the agent ID
   * @throws Error if no agents are available and pool is at capacity
   */
  async acquireAgent(
    agentKind: AgentKindEnum,
    agentType: AgentTypeValue,
    version?: number,
  ): Promise<AgentWithInstance<TAgentInstance>> {
    this.logger.debug("Attempting to acquire agent", { agentKind, agentType, version });
    const config = this.getAgentConfig(agentKind, agentType, version);
    const pool = this.getAgentTypeVersionSet(agentKind, agentType, config.agentConfigVersion);

    if (!pool || config.maxPoolSize === 0) {
      this.logger.debug("No pool available, creating new agent", { agentType: agentType });
      return this._acquireAgent(
        await this.createAgent(agentKind, agentType, config.agentConfigVersion),
      );
    }

    // Try to get an available agent from the pool
    for (const agentId of pool) {
      const agent = this.agents.get(agentId);
      if (agent && !agent.inUse) {
        pool.delete(agentId);
        this.logger.debug("Acquired agent from pool", { agentType: agentType, agentId });
        return this._acquireAgent(agent);
      }
    }

    // No available agents in pool
    if (pool.size < config.maxPoolSize) {
      this.logger.debug("Pool not at capacity, creating new agent", {
        agentKind,
        agentType,
        version: config.agentConfigVersion,
        currentSize: pool.size,
        maxSize: config.maxPoolSize,
      });
      return this._acquireAgent(
        await this.createAgent(agentKind, agentType, config.agentConfigVersion),
      );
    }

    this.logger.error("No available agents and pool at capacity", {
      agentKind,
      agentType,
      version: config.agentConfigVersion,
      poolSize: config.maxPoolSize,
    });
    throw new Error(
      `No available agents of kind '${agentKind}' type '${agentType}' version '${config.agentConfigVersion}' in pool and pool is at capacity`,
    );
  }

  private async _acquireAgent(agent: Agent) {
    const { agentId } = agent;
    agent.inUse = true;

    if (this.lifecycleCallbacks.onAcquire) {
      this.logger.trace("Executing onAcquire callback", { agentId });
      await this.lifecycleCallbacks.onAcquire(agentId);
    }
    agentStateLogger().logAgentAcquire({
      agentId: agent.agentId,
    });

    const [poolStats, versions] = this.getPoolStats(agent.agentKind, agent.agentType);
    agentStateLogger().logPoolChange({
      agentTypeId: agentSomeIdToTypeValue(agent),
      poolStats,
      versions,
    });

    return agent as AgentWithInstance<TAgentInstance>;
  }

  /**
   * Releases an agent back to its pool or destroys it
   * @param agentId - ID of the agent to release
   * @throws Error if agent is not found
   */
  async releaseAgent(agentId: AgentIdValue): Promise<void> {
    this.logger.debug("Attempting to release agent", { agentId });
    const agent = this.agents.get(agentId);
    if (!agent) {
      this.logger.error("Agent not found for release", { agentId });
      throw new Error(`Agent with ID '${agentId}' not found`);
    }

    const { agentKind, agentType, agentConfigVersion: version, maxPoolSize } = agent.config;
    const pool = this.getAgentTypeVersionSet(agentKind, agentType, version);

    if (!pool || maxPoolSize === 0) {
      this.logger.debug("No pool available, destroying agent", { agentId });
      await this.destroyAgent(agentId);
      return;
    }

    if (this.lifecycleCallbacks.onRelease) {
      this.logger.trace("Executing onRelease callback", { agentId });
      await this.lifecycleCallbacks.onRelease(agentId);
    }

    // Return to pool
    agent.inUse = false;
    pool.add(agentId);
    this.logger.debug("Agent released back to pool", { agentId, agentType: agent.agentType });
    agentStateLogger().logAgentRelease({
      agentId: agent.agentId,
    });

    const [poolStats, versions] = this.getPoolStats(agent.agentKind, agent.agentType);
    agentStateLogger().logPoolChange({
      agentTypeId: agentSomeIdToTypeValue(agent),
      poolStats,
      versions,
    });
  }

  private async createAgent(
    agentKind: AgentKindEnum,
    agentType: AgentTypeValue,
    agentConfigVersion: number,
  ): Promise<AgentWithInstance<TAgentInstance>> {
    this.logger.debug("Creating new agent", { agentKind, agentType });
    const config = this.getAgentConfig(agentKind, agentType, agentConfigVersion);
    const versionPoolStats = this.getPoolStatsByVersion(agentKind, agentType, agentConfigVersion);
    const toolsFactory = this.getToolsFactory(agentKind);
    const agentNum = versionPoolStats.created + 1;
    const agentId = agentIdToString({
      agentKind,
      agentType,
      agentNum: agentNum,
      agentConfigVersion: agentConfigVersion,
    });
    const { instance } = await this.lifecycleCallbacks.onCreate(config, agentId, toolsFactory);

    const agent = {
      agentId,
      agentKind,
      agentType,
      agentNum,
      agentConfigVersion: config.agentConfigVersion,
      config,
      inUse: false,
      instance,
    } satisfies Agent;
    this.agents.set(agentId, agent);

    const pool = this.getAgentTypeVersionSetsArray(agentKind, agentType);
    let poolVersionSetArrayItem = pool.find((p) => p[0] === agentConfigVersion);
    if (!poolVersionSetArrayItem) {
      poolVersionSetArrayItem = [agentConfigVersion, new Set([])];
      pool.push(poolVersionSetArrayItem);
    }
    poolVersionSetArrayItem[1].add(agentId);
    this.logger.trace("Added agent to pool", { agentKind, agentType, agentId });

    this.logger.info("Agent created successfully", { agentId, agentType, agentKind });

    agentStateLogger().logAgentCreate({
      agentId: agentId,
      agentConfigId: config.agentConfigId,
    });

    const [poolStats, versions] = this.getPoolStats(agentKind, agentType);
    agentStateLogger().logPoolChange({
      agentTypeId: agentSomeIdToTypeValue(agent),
      poolStats,
      versions,
    });
    return agent;
  }

  private async destroyAgent(agentId: AgentIdValue): Promise<void> {
    this.logger.debug("Attempting to destroy agent", { agentId });
    const agent = this.agents.get(agentId);
    if (!agent) {
      this.logger.error("Agent not found for destruction", { agentId });
      throw new Error(`Agent with ID '${agentId}' not found`);
    }

    const { agentKind, agentType, agentConfigVersion } = agent;

    await this.lifecycleCallbacks.onDestroy(agent.instance);

    // Remove from pool if it's in one
    const poolSet = this.getAgentTypeVersionSet(agentKind, agentType, agentConfigVersion);
    if (poolSet) {
      poolSet.delete(agentId);
      this.logger.trace("Removed agent from pool", {
        agentId,
        agentKind,
        agentType,
        agentConfigVersion,
      });
    } else {
      throw new Error(`Missing pool`);
    }

    if (!poolSet.size) {
      // Remove pool version array set item
      const poolVersionSetsArray = this.getAgentTypeVersionSetsArray(agentKind, agentType);
      const poolVersionSet = poolVersionSetsArray.findIndex((it) => it[0] === agentConfigVersion);
      poolVersionSetsArray.splice(poolVersionSet, 1);
    }

    this.agents.delete(agentId);
    this.logger.info("Agent destroyed successfully", {
      agentKind,
      agentType,
      agentConfigVersion,
    });

    agentStateLogger().logAgentDestroy({
      agentId,
    });

    const [poolStats, versions] = this.getPoolStats(agentKind, agentType);
    agentStateLogger().logPoolChange({
      agentTypeId: agentSomeIdToTypeValue(agent),
      poolStats,
      versions,
    });
  }

  /**
   * Returns list of all active agent instances
   * @returns Array of active agents
   */
  getActiveAgents(
    agentKind?: AgentKindEnum,
    agentType?: AgentTypeValue,
    agentConfigVersion?: number,
  ): Agent[] {
    this.logger.trace("Getting active agents");
    return Array.from(this.agents.values()).filter((a) => {
      if (agentKind && agentKind !== a.agentKind) {
        return false;
      }
      if (agentType && agentType !== a.agentType) {
        return false;
      }
      if (agentConfigVersion != null && agentConfigVersion !== a.config.agentConfigVersion) {
        return false;
      }
      return a.inUse;
    });
  }

  getAgent(agentId: AgentIdValue): Agent {
    this.logger.trace("Getting agent by ID", { agentId });
    const agent = this.agents.get(agentId);
    if (!agent) {
      this.logger.error("Agent not found", { agentId });
      throw new Error(`Agent with ID '${agentId}' not found`);
    }
    return agent;
  }

  getPoolStats(
    agentKind: AgentKindEnum,
    agentType: AgentTypeValue,
  ): [AgentConfigPoolStats, [number, AgentConfigPoolStats][]] {
    this.logger.trace("Getting pool statistics", { agentKind, agentType });
    const pool = this.getAgentTypeVersionSetsArray(agentKind, agentType);

    if (!pool) {
      return [{ poolSize: 0, available: 0, active: 0, created: 0 }, []];
    }

    const versionedAgents = pool.map(
      ([version, set]) => [version, Array.from(set).map(this.getAgent.bind(this))] as const,
    );
    const versions = versionedAgents.map(([version, agents]) => {
      const available = agents.filter((agent) => !agent.inUse).length;
      const config = this.getAgentConfig(agentKind, agentType, version);
      const stats = {
        poolSize: config.maxPoolSize,
        available,
        active: agents.length - available,
        created: agents.length,
      } satisfies AgentConfigPoolStats;
      return [version, stats] as [number, AgentConfigPoolStats];
    });

    const stats = versions.reduce(
      (prev, [, curr]) => {
        const sum = {
          available: curr.available + prev.available,
          created: curr.created + prev.created,
          active: curr.active + prev.active,
          poolSize: curr.poolSize + prev.poolSize,
        } satisfies AgentConfigPoolStats;
        return sum;
      },
      {
        poolSize: 0,
        available: 0,
        active: 0,
        created: 0,
      } satisfies AgentConfigPoolStats,
    );

    this.logger.debug("Pool statistics", { agentType: agentType, ...stats });
    return [stats, versions];
  }

  private getPoolStatsByVersion(
    agentKind: AgentKindEnum,
    agentType: AgentTypeValue,
    version: number,
  ) {
    // FIXME Unoptimized
    const [, versions] = this.getPoolStats(agentKind, agentType);
    const found = versions.find(([currVersion]) => currVersion === version);
    if (!found) {
      return { poolSize: 0, available: 0, active: 0, created: 0 };
    }
    const [, versionStats] = found;
    return versionStats;
  }
}
