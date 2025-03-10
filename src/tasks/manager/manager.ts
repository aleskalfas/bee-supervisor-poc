import {
  FULL_ACCESS,
  READ_EXECUTE_ACCESS,
  READ_ONLY_ACCESS,
  READ_WRITE_ACCESS,
  ResourcesAccessControl,
  WRITE_ONLY_ACCESS,
} from "@/access-control/resources-access-control.js";
import { agentSomeIdToTypeValue } from "@/agents/agent-id.js";
import {
  AgentConfigVersionValue,
  AgentIdValue,
  AgentKindEnum,
  AgentTypeValue,
} from "@/agents/registry/dto.js";
import { updateDeepPartialObject } from "@/utils/objects.js";
import { AgentStateLogger } from "@agents/state/logger.js";
import { TaskStateLogger } from "@tasks/state/logger.js";
import { WorkspaceResource } from "@workspaces/manager/index.js";
import { WorkspaceRestorable } from "@workspaces/restore/index.js";
import { FrameworkError } from "bee-agent-framework";
import { clone, isNonNullish, omit } from "remeda";
import { taskConfigIdToValue, taskRunIdToString, taskSomeIdToTypeValue } from "../task-id.js";
import {
  isTaskRunActiveStatus,
  isTaskRunTerminationStatus,
  TaskConfig,
  TaskConfigIdValue,
  TaskConfigOwnedResource,
  TaskConfigOwnedResourceSchema,
  TaskConfigPoolStats,
  TaskConfigVersionValue,
  TaskKindEnum,
  TaskKindEnumSchema,
  TaskRun,
  TaskRunHistoryEntry,
  TaskRunIdValue,
  TaskRunStatusEnumSchema,
  TaskRunTerminalStatusEnum,
  TaskTypeValue,
} from "./dto.js";

export type TaskRunRuntime = TaskRun & {
  intervalId: NodeJS.Timeout | null;
};

const TASK_MANAGER_RESOURCE = "task_manager";
const TASK_MANAGER_USER = "task_manager_user";
const TASK_MANAGER_CONFIG_PATH = ["configs", "task_manager.jsonl"] as const;

const MAX_POOL_SIZE = 100;

export interface TaskManagerSwitches {
  restoration: boolean;
}

export interface TaskMangerOptions {
  errorHandler?: (error: Error, taskRunId: TaskRunIdValue) => void;
  occupancyTimeoutMs?: number;
  adminIds?: string[];
  maxHistoryEntries?: number;
}

export type OnTaskStart = (
  taskRun: TaskRun,
  taskManager: TaskManager,
  callbacks: {
    onAwaitingAgentAcquired: (taskRunId: TaskRunIdValue, taskManage: TaskManager) => void;
    onAgentAcquired: (
      taskRunId: TaskRunIdValue,
      agentId: AgentIdValue,
      taskManage: TaskManager,
    ) => void;
    onAgentComplete: (
      output: string,
      taskRunId: TaskRunIdValue,
      agentId: AgentIdValue,
      taskManage: TaskManager,
    ) => void;
    onAgentError: (
      err: Error,
      taskRunId: TaskRunIdValue,
      agentId: AgentIdValue,
      taskManage: TaskManager,
    ) => void;
  },
) => Promise<unknown>;

export interface TaskManagerConfig {
  onTaskStart: OnTaskStart;
  options?: TaskMangerOptions;
  switches?: TaskManagerSwitches;
}

export class TaskManager extends WorkspaceRestorable {
  /** Map of registered task type and their configurations */
  private taskConfigs: Map<TaskKindEnum, Map<TaskTypeValue, TaskConfig[]>>;
  private taskRuns = new Map<TaskRunIdValue, TaskRunRuntime>();
  /** Map of task run pools by task config and task run IDs */
  private taskPools: Map<
    TaskKindEnum,
    Map<TaskTypeValue, [TaskConfigVersionValue, Set<TaskConfigIdValue>][]>
  >;
  private scheduledTasksToStart: { taskRunId: TaskRunIdValue; actingAgentId: AgentIdValue }[] = [];
  private taskStartIntervalId: NodeJS.Timeout | null = null;
  private awaitingTasksForAgents: {
    taskRunId: TaskRunIdValue;
    agentTypeId: string;
  }[] = [];
  private registeredAgentTypes = new Map<AgentKindEnum, AgentTypeValue[]>();
  private ac: ResourcesAccessControl;
  private stateLogger: TaskStateLogger;
  private agentStateLogger: AgentStateLogger;
  private onTaskStart: OnTaskStart;
  private options: TaskMangerOptions;
  private _switches: TaskManagerSwitches;

  constructor({ onTaskStart, options, switches }: TaskManagerConfig) {
    super(TASK_MANAGER_CONFIG_PATH, TASK_MANAGER_USER);
    this.logger.info("Initializing TaskManager");
    this.stateLogger = TaskStateLogger.getInstance();
    this.agentStateLogger = AgentStateLogger.getInstance();

    this.ac = new ResourcesAccessControl(this.constructor.name, [TASK_MANAGER_USER]);
    this.ac.createResource(TASK_MANAGER_RESOURCE, TASK_MANAGER_USER, TASK_MANAGER_USER);

    this.onTaskStart = onTaskStart;

    this.options = {
      errorHandler: (error: Error, taskRunId: TaskRunIdValue) => {
        this.logger.error({ taskRunId, error }, "Task error occurred");
      },
      occupancyTimeoutMs: 30 * 60 * 1000,
      adminIds: [],
      maxHistoryEntries: 100, // Default to keeping last 100 entries
      ...(options || {}),
    };

    // Initialize task pools for all task kinds
    this.taskConfigs = new Map(TaskKindEnumSchema.options.map((kind) => [kind, new Map()]));
    this.taskPools = new Map(TaskKindEnumSchema.options.map((kind) => [kind, new Map()]));
    this._switches = { restoration: true, ...clone(switches) };

    this.taskStartIntervalId = setInterval(async () => {
      try {
        await this.processNextStartTask(); // Your async function
      } catch (err) {
        this.logger.error(err, "Process next start task error");
      }
    }, 100); // Runs every 100ms (0.1 second)
  }

  get switches() {
    return clone(this._switches);
  }

  restore(actingAgentId: AgentIdValue): void {
    if (this.switches.restoration === false) {
      this.logger.warn(`Skipping restoration`);
      return;
    }
    super.restore(actingAgentId);
  }

  protected restoreEntity(
    resource: WorkspaceResource,
    line: string,
    actingAgentId: AgentIdValue,
  ): void {
    this.logger.info(`Restoring previous state from ${resource.path}`);
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      this.logger.error(e);
      throw new Error(`Failed to parse JSON: ${line}`);
    }
    const taskConfigResult = TaskConfigOwnedResourceSchema.safeParse(parsed);
    if (taskConfigResult.success) {
      this.createTaskConfig(
        taskConfigResult.data.taskConfig,
        taskConfigResult.data.ownerId,
        actingAgentId,
        false,
      );
      return;
    }

    this.logger.error(taskConfigResult, `Can't restore task config`);
    throw new Error(`Can't restore`);
  }

  protected getSerializedEntities(): string {
    return Array.from(this.taskConfigs.entries())
      .map(([taskKind, typeMap]) =>
        Array.from(typeMap.entries()).map(([taskType, versions]) => {
          const taskConfig = versions.at(-1);
          if (!taskConfig) {
            throw new Error(
              `Task ${taskSomeIdToTypeValue({ taskKind, taskType })} has no version to serialize`,
            );
          }
          const { ownerId } = this.ac.getResourcePermissionsByAdmin(
            taskConfig.taskConfigId,
            TASK_MANAGER_USER,
          )!;
          const config = { ownerId, taskConfig } satisfies TaskConfigOwnedResource;
          return JSON.stringify(config);
        }),
      )
      .flat()
      .join("\n");
  }

  registerAdminAgent(agentId: AgentIdValue) {
    this.ac.createPermissions(TASK_MANAGER_RESOURCE, agentId, FULL_ACCESS, TASK_MANAGER_USER);
  }

  registerAgentType(agentKind: AgentKindEnum, agentType: string): void {
    let types = this.registeredAgentTypes.get(agentKind);
    if (!types) {
      types = [agentType];
      this.registeredAgentTypes.set(agentKind, types);
    } else {
      if (types.includes(agentType)) {
        throw new Error(`Agent type duplicity for agentKind:${agentKind}, agentType:${agentType}`);
      }
      types.push(agentType);
    }
    this.stateLogger.logAgentTypeRegister({
      agentTypeId: agentSomeIdToTypeValue({ agentKind, agentType }),
    });
  }

  getTaskRun(
    taskRunId: TaskRunIdValue,
    actingAgentId: AgentIdValue,
    permissions = READ_ONLY_ACCESS,
  ): TaskRunRuntime {
    this.logger.trace({ taskRunId }, "Getting task run by ID");
    this.ac.checkPermission(taskRunId, actingAgentId, permissions);

    const taskRun = this.taskRuns.get(taskRunId);
    if (!taskRun) {
      this.logger.error({ taskRunId }, "Task run not found");
      throw new Error(`Task run with ID '${taskRunId}' not found`);
    }
    return taskRun;
  }

  getPoolStats(
    taskKind: TaskKindEnum,
    taskType: TaskTypeValue,
    actingAgentId: AgentIdValue,
  ): [TaskConfigPoolStats, [number, TaskConfigPoolStats][]] {
    this.logger.trace({ taskKind, taskType, actingAgentId }, "Getting pool statistics");

    this.ac.checkPermission(TASK_MANAGER_RESOURCE, actingAgentId, READ_ONLY_ACCESS);

    const pool = this.getTaskTypeVersionSetsArray(taskKind, taskType, false);
    if (!pool) {
      return [
        {
          poolSize: 0,
          created: 0,
          running: 0,
          pending: 0,
          awaiting_agent: 0,
          stopped: 0,
          failed: 0,
          completed: 0,
          terminated: 0,
          active: 0,
          total: 0,
        },
        [],
      ];
    }

    const versionedTaskRuns = pool.map(
      ([version, set]) =>
        [
          version,
          Array.from(set)
            .map((t) => {
              if (this.ac.hasPermission(t, actingAgentId, READ_ONLY_ACCESS)) {
                return this.getTaskRun(t, actingAgentId, READ_ONLY_ACCESS);
              }
            })
            .filter(isNonNullish),
        ] as const,
    );
    const versions = versionedTaskRuns.map(([version, taskRuns]) => {
      const config = this.getTaskConfig(taskKind, taskType, actingAgentId, version);
      const stats = {
        poolSize: config.concurrencyMode === "EXCLUSIVE" ? 1 : MAX_POOL_SIZE,
        active: taskRuns.filter((t) => isTaskRunActiveStatus(t.status)).length,
        terminated: taskRuns.filter((t) => isTaskRunTerminationStatus(t.status)).length,
        completed: taskRuns.filter((t) => t.status === "COMPLETED").length,
        running: taskRuns.filter((t) => t.status === "EXECUTING").length,
        failed: taskRuns.filter((t) => t.status === "FAILED").length,
        stopped: taskRuns.filter((t) => t.status === "STOPPED").length,
        pending: taskRuns.filter((t) => t.status === "PENDING").length,
        awaiting_agent: taskRuns.filter((t) => t.status === "AWAITING_AGENT").length,
        created: taskRuns.filter((t) => t.status === "CREATED").length,
        total: taskRuns.length,
      } satisfies TaskConfigPoolStats;
      return [version, stats] as [number, TaskConfigPoolStats];
    });

    const stats = versions.reduce(
      (prev, [, curr]) => {
        const sum = {
          poolSize: curr.poolSize + prev.poolSize,
          active: curr.active + prev.active,
          terminated: curr.terminated + prev.terminated,
          completed: curr.completed + prev.completed,
          running: curr.running + prev.running,
          failed: curr.failed + prev.failed,
          stopped: curr.stopped + prev.stopped,
          pending: curr.pending + prev.pending,
          awaiting_agent: curr.awaiting_agent + prev.awaiting_agent,
          created: curr.created + prev.created,
          total: curr.total + prev.total,
        } satisfies TaskConfigPoolStats;
        return sum;
      },
      {
        poolSize: 0,
        active: 0,
        terminated: 0,
        completed: 0,
        running: 0,
        failed: 0,
        stopped: 0,
        pending: 0,
        awaiting_agent: 0,
        created: 0,
        total: 0,
      } satisfies TaskConfigPoolStats,
    );

    this.logger.trace({ taskType: taskType, ...stats }, "Pool statistics");
    return [stats, versions];
  }

  private getPoolStatsByVersion(
    taskKind: TaskKindEnum,
    taskType: TaskTypeValue,
    taskConfigVersion: number,
    actingAgentId: AgentIdValue,
  ) {
    // FIXME Unoptimized
    const [, versions] = this.getPoolStats(taskKind, taskType, actingAgentId);
    const found = versions.find(([currVersion]) => currVersion === taskConfigVersion);
    if (!found) {
      return {
        poolSize: 0,
        active: 0,
        terminated: 0,
        completed: 0,
        running: 0,
        failed: 0,
        stopped: 0,
        pending: 0,
        awaiting_agent: 0,
        created: 0,
        total: 0,
      } satisfies TaskConfigPoolStats;
    }
    const [, versionStats] = found;
    return versionStats;
  }

  private getTaskKindPoolMap(taskKind: TaskKindEnum) {
    const poolKind = this.taskPools.get(taskKind);
    if (!poolKind) {
      throw new Error(`There is missing pool for task taskKind:${taskKind}`);
    }
    return poolKind;
  }

  private getTaskTypeVersionSetsArray(
    taskKind: TaskKindEnum,
    taskType: AgentTypeValue,
    throwError = true,
  ) {
    const poolKind = this.getTaskKindPoolMap(taskKind);
    const pool = poolKind.get(taskType);
    if (!pool && throwError) {
      throw new Error(
        `There is missing pool version sets array for agent agentKind:${taskKind} agentType:${taskType}`,
      );
    }
    return pool;
  }

  private getTaskTypeVersionSet(
    taskKind: TaskKindEnum,
    taskType: TaskTypeValue,
    taskConfigVersion: number,
  ) {
    const poolVersionSetsArray = this.getTaskTypeVersionSetsArray(taskKind, taskType)!;
    const poolVersionSet = poolVersionSetsArray.find((it) => it[0] === taskConfigVersion);
    if (!poolVersionSet) {
      throw new Error(
        `There is missing pool version set for task taskKind:${taskKind} taskType:${taskType} version:${taskConfigVersion}`,
      );
    }
    return poolVersionSet[1];
  }

  createTaskConfig(
    config: Omit<TaskConfig, "taskConfigVersion" | "taskConfigId" | "ownerAgentId">,
    ownerAgentId: string,
    actingAgentId: AgentIdValue,
    persist = true,
  ): TaskConfig {
    const { taskKind, taskType, maxRepeats: maxRuns } = config;
    this.logger.info(
      {
        taskKind,
        taskType,
        maxRuns,
      },
      "Create new task config",
    );
    this.ac.checkPermission(TASK_MANAGER_RESOURCE, actingAgentId, WRITE_ONLY_ACCESS);

    const taskTypesMap = this.getTaskConfigMap(taskKind);
    if (taskTypesMap.has(taskType)) {
      this.logger.error({ taskType }, "Task type already registered");
      throw new Error(`Task type '${taskType}' is already registered`);
    }

    if (!this.registeredAgentTypes.get(config.agentKind)?.includes(config.agentType)) {
      throw new Error(
        `Agent kind: ${config.agentKind} type: ${config.agentType} wasn't yet registered`,
      );
    }

    const taskConfigVersion = 1;
    const taskConfigId = taskConfigIdToValue({
      ...config,
      taskConfigVersion,
    });
    const configVersioned = {
      ...config,
      taskConfigId,
      ownerAgentId,
      taskConfigVersion,
    } satisfies TaskConfig;
    taskTypesMap.set(taskType, [configVersioned]);

    // Permissions
    this.ac.createResource(taskConfigId, ownerAgentId, actingAgentId);
    this.ac.createPermissions(taskConfigId, ownerAgentId, READ_EXECUTE_ACCESS, actingAgentId);

    this.stateLogger.logTaskConfigCreate({
      taskConfigId,
      taskType: taskSomeIdToTypeValue(configVersioned),
      config: configVersioned,
    });

    this.initializeTaskPool(taskKind, taskType, taskConfigVersion);

    if (persist) {
      this.persist();
    }

    return configVersioned;
  }

  private initializeTaskPool(taskKind: TaskKindEnum, taskType: TaskTypeValue, version: number) {
    this.logger.debug(
      {
        taskKind,
        taskType,
        version,
      },
      "Initializing task pool",
    );

    const kindPool = this.getTaskKindPoolMap(taskKind);
    let typePool = kindPool.get(taskType);
    if (!typePool) {
      typePool = [];
      kindPool.set(taskType, typePool);
    }
    typePool.push([version, new Set([])]);
  }

  private getTaskConfigMap(taskKind: TaskKindEnum) {
    const typesMap = this.taskConfigs.get(taskKind);
    if (!typesMap) {
      throw new Error(`There is missing types map for task taskKind:${taskKind}`);
    }
    return typesMap;
  }

  private getTaskConfigTypeMap(taskKind: TaskKindEnum, taskType: TaskTypeValue) {
    const taskConfigTypeMap = this.getTaskConfigMap(taskKind);
    const taskConfigVersions = taskConfigTypeMap.get(taskType);
    if (!taskConfigVersions) {
      this.logger.error({ taskKind, taskType }, "Task config type map was not found");
      throw new Error(`Task kind '${taskKind}' type '${taskType}' was not found`);
    }
    return taskConfigVersions;
  }

  getTaskConfig(
    taskKind: TaskKindEnum,
    taskType: TaskTypeValue,
    actingAgentId: AgentIdValue,
    taskConfigVersion?: number,
    permissions = READ_ONLY_ACCESS,
  ): TaskConfig {
    const configVersions = this.getTaskConfigMap(taskKind).get(taskType);
    if (!configVersions) {
      this.logger.error({ taskKind, taskType }, "Task config not found");
      throw new Error(`Task kind '${taskKind}' type '${taskType}' was not found`);
    }

    let result;
    if (taskConfigVersion != null) {
      const configVersion = configVersions.find((c) => c.taskConfigVersion === taskConfigVersion);
      if (!configVersion) {
        this.logger.error(
          { taskKind, taskType, taskConfigVersion },
          "Task config version not found",
        );
        throw new Error(
          `Task kind '${taskKind}' type '${taskType}' version '${taskConfigVersion}' was not found`,
        );
      }
      result = configVersion;
    }

    const lastConfigVersion = configVersions.at(-1);
    if (lastConfigVersion == null) {
      this.logger.error(
        { taskKind, taskType, taskConfigVersion },
        "Task config last version was not found",
      );
      throw new Error(`Task kind '${taskKind}' type '${taskType}' last version was not found`);
    }
    result = lastConfigVersion;
    this.ac.checkPermission(lastConfigVersion.taskConfigId, actingAgentId, permissions);
    return result;
  }

  updateTaskConfig(
    update: Pick<TaskConfig, "taskKind" | "taskType"> &
      Partial<
        Pick<
          TaskConfig,
          | "description"
          | "intervalMs"
          | "taskConfigInput"
          | "runImmediately"
          | "maxRepeats"
          | "maxRetries"
          | "retryDelayMs"
          | "concurrencyMode"
        >
      >,
    actingAgentId: AgentIdValue,
  ) {
    const { taskKind, taskType } = update;

    const config = this.getTaskConfig(
      taskKind,
      taskType,
      actingAgentId,
      undefined,
      READ_WRITE_ACCESS,
    );

    const newConfigVersion = clone(config);

    const taskConfigVersion = config.taskConfigVersion + 1;
    const taskConfigId = taskConfigIdToValue({
      ...config,
      taskConfigVersion,
    });
    updateDeepPartialObject(newConfigVersion, {
      ...update,
      taskConfigId,
      taskConfigVersion,
    });
    const configVersions = this.getTaskConfigTypeMap(taskKind, taskType);
    configVersions.push(newConfigVersion);

    this.ac.createResource(taskConfigId, config.ownerAgentId, actingAgentId);
    this.ac.createPermissions(
      taskConfigId,
      config.ownerAgentId,
      READ_EXECUTE_ACCESS,
      actingAgentId,
    );

    this.stateLogger.logTaskConfigUpdate({
      taskType: taskSomeIdToTypeValue(newConfigVersion),
      taskConfigId: newConfigVersion.taskConfigId,
      config: newConfigVersion,
    });

    this.persist();
    return newConfigVersion;
  }

  destroyTaskConfig(
    taskKind: TaskKindEnum,
    taskType: TaskTypeValue,
    actingAgentId: AgentIdValue,
  ): void {
    this.logger.trace({ taskKind, taskType, actingAgentId }, "Destroying agent configuration");

    const configVersions = this.getTaskConfigMap(taskKind).get(taskType);
    if (!configVersions) {
      this.logger.error({ taskKind, taskType }, "Task config versions was not found");
      throw new Error(`Task kind '${taskKind}' type '${taskType}' config versions was not found`);
    }

    let index = 0;
    for (const { taskConfigVersion, taskConfigId } of configVersions) {
      this.ac.checkPermission(taskConfigId, actingAgentId, READ_WRITE_ACCESS);
      const stats = this.getPoolStatsByVersion(
        taskKind,
        taskType,
        taskConfigVersion,
        actingAgentId,
      );
      if (stats.active) {
        this.logger.error(
          { taskKind, taskType, stats },
          "Task config can't be destroyed while it is still has active runs",
        );
        throw new Error(
          `Task config kind '${taskKind}' type '${taskType}' version '${taskConfigVersion}' can't be destroyed while it is still has active runs.`,
        );
      }
      configVersions.splice(index, 1)[0];
      this.logger.info(
        {
          taskConfigId,
          taskKind,
          taskType,
          taskConfigVersion,
        },
        "Task config destroyed successfully",
      );

      this.stateLogger.logTaskConfigDestroy({
        taskConfigId,
        taskType,
      });

      this.ac.removeResource(taskConfigId, actingAgentId);

      const [poolStats, versions] = this.getPoolStats(taskKind, taskType, actingAgentId);
      this.stateLogger.logPoolChange({
        taskTypeId: taskSomeIdToTypeValue({ taskKind, taskType }),
        poolStats,
        versions,
      });

      index++;
    }

    if (!configVersions.length) {
      this.getTaskConfigMap(taskKind).delete(taskType);
      this.ac.removeResource(taskSomeIdToTypeValue({ taskKind, taskType }), actingAgentId);
    }

    if (!this.getTaskConfigMap(taskKind).size) {
      this.taskConfigs.delete(taskKind);
    }

    this.persist();
  }

  createTaskRun(
    taskKind: TaskKindEnum,
    taskType: TaskTypeValue,
    taskRunInput: string,
    actingAgentId: AgentIdValue,
  ): TaskRun {
    this.logger.debug(
      {
        taskKind,
        taskType,
        actingAgentId,
      },
      "Creating new task run",
    );

    const config = this.getTaskConfig(
      taskKind,
      taskType,
      actingAgentId,
      undefined,
      READ_EXECUTE_ACCESS,
    );

    this.ac.checkPermission(config.taskConfigId, actingAgentId, READ_EXECUTE_ACCESS);

    const { taskConfigVersion } = config;
    const versionPoolStats = this.getPoolStatsByVersion(
      taskKind,
      taskType,
      taskConfigVersion,
      actingAgentId,
    );
    const taskRunNum = versionPoolStats.created + 1;
    const taskRunId = taskRunIdToString({
      taskKind,
      taskType,
      taskRunNum,
      taskConfigVersion,
    });

    const types = this.registeredAgentTypes.get(config.agentKind);
    if (!types || !types.includes(config.agentType)) {
      throw new Error(
        `Unregistered task type for task.agentKind:${config.agentKind} task.agentType: ${config.agentType}`,
      );
    }

    const taskRun: TaskRun = {
      taskKind,
      taskType,
      taskRunId,
      taskConfigVersion: config.taskConfigVersion,
      taskRunNum,
      taskRunInput: taskRunInput,
      config: clone(config),
      status: "CREATED",
      currentRetryAttempt: 0,
      isOccupied: false,
      errorCount: 0,
      ownerAgentId: config.ownerAgentId,
      completedRuns: 0,
      history: [],
    };
    this.taskRuns.set(taskRunId, {
      intervalId: null,
      ...taskRun,
    });

    this.stateLogger.logTaskRunCreate({
      taskConfigId: taskRun.config.taskConfigId,
      taskRunId,
      taskRun,
    });

    this.ac.createResource(taskRunId, actingAgentId, actingAgentId);

    const pool = this.getTaskTypeVersionSetsArray(taskKind, taskType)!;
    let poolVersionSetArrayItem = pool.find((p) => p[0] === taskConfigVersion);
    if (!poolVersionSetArrayItem) {
      poolVersionSetArrayItem = [taskConfigVersion, new Set([])];
      pool.push(poolVersionSetArrayItem);
    }
    poolVersionSetArrayItem[1].add(taskRunId);
    this.logger.trace({ taskKind, taskType, taskConfigVersion, taskRunId }, "Added task to pool");

    const [poolStats, versions] = this.getPoolStats(taskKind, taskType, actingAgentId);
    this.stateLogger.logPoolChange({
      taskTypeId: taskSomeIdToTypeValue({ taskKind, taskType }),
      poolStats,
      versions,
    });

    if (config.runImmediately) {
      this.scheduleStartTaskRun(taskRunId, actingAgentId);
    }

    return taskRun;
  }

  /**
   * Schedule task to start as soon as possible.
   * Only owners and admins can start/stop tasks.
   */
  scheduleStartTaskRun(taskRunId: TaskRunIdValue, actingAgentId: AgentIdValue): void {
    this.logger.info({ taskRunId, actingAgentId }, "Schedule task run start");
    this.ac.checkPermission(taskRunId, actingAgentId, FULL_ACCESS);

    const taskRun = this.taskRuns.get(taskRunId);
    if (!taskRun) {
      this.logger.error({ taskRunId }, "Task run not found");
      throw new Error(`Task run ${taskRunId} not found`);
    }

    const { taskKind, taskType, taskConfigVersion } = taskRun;

    const versionPoolStats = this.getPoolStatsByVersion(
      taskKind,
      taskType,
      taskConfigVersion,
      actingAgentId,
    );

    if (versionPoolStats.active >= versionPoolStats.poolSize) {
      this.logger.trace({ taskKind, taskType, taskConfigVersion }, "Task pool population is full");
      return;
    }

    this._updateTaskRun(taskRunId, taskRun, {
      status: "SCHEDULED",
    });
    this.scheduledTasksToStart.push({ taskRunId, actingAgentId });
  }

  async processNextStartTask() {
    if (!this.scheduledTasksToStart.length) {
      return;
    }
    const { taskRunId, actingAgentId } = this.scheduledTasksToStart.shift()!;

    this.logger.info({ taskRunId, actingAgentId }, "Starting scheduled task run");

    const taskRun = this.getTaskRun(taskRunId, actingAgentId, FULL_ACCESS);
    if (taskRun.status === "EXECUTING") {
      this.logger.warn({ taskRunId }, "Task is already executing");
      throw new Error(`Task ${taskRunId} is already executing`);
    }

    if (taskRun.config.runImmediately || !taskRun.config.intervalMs) {
      this.logger.debug({ taskRunId }, "Executing task immediately");
      await this.executeTask(taskRunId, actingAgentId);
    }

    if (
      taskRun.config.intervalMs &&
      (taskRun.config.maxRepeats == null || taskRun.completedRuns < taskRun.config.maxRepeats)
    ) {
      this.logger.debug(
        {
          taskRunId,
          intervalMs: taskRun.config.intervalMs,
        },
        "Setting up task interval",
      );
      const self = this;
      taskRun.intervalId = setInterval(async () => {
        self.executeTask(taskRunId, actingAgentId);
      }, taskRun.config.intervalMs);

      this._updateTaskRun(taskRunId, taskRun, {
        status: "PENDING",
        nextRunAt: new Date(Date.now() + taskRun.config.intervalMs),
      });
    }

    this.logger.info({ taskRunId }, "Task started successfully");
  }

  stopTaskRun(taskRunId: TaskRunIdValue, actingAgentId: AgentIdValue, isCompleted = false): void {
    this.logger.info({ taskRunId, actingAgentId }, "Stopping task");
    this.ac.checkPermission(taskRunId, actingAgentId, READ_WRITE_ACCESS);

    const taskRun = this.getTaskRun(taskRunId, actingAgentId);
    if (taskRun.status === "STOPPED") {
      this.logger.debug({ taskRunId }, "Task already stopped");
      return;
    }

    if (taskRun.intervalId) {
      this.logger.debug({ taskRunId }, "Clearing task interval");
      clearInterval(taskRun.intervalId);
      taskRun.intervalId = null;
    }

    if (taskRun.isOccupied) {
      this.logger.debug({ taskRunId }, "Releasing task occupancy before stop");
      this.releaseTaskRunOccupancy(taskRunId, actingAgentId);
    }

    this._updateTaskRun(taskRunId, taskRun, {
      status: isCompleted ? "COMPLETED" : "STOPPED",
      nextRunAt: undefined,
    });
    this.logger.info({ taskRunId }, "Task stopped successfully");
  }

  destroyTaskRun(taskRunId: TaskRunIdValue, actingAgentId: AgentIdValue): void {
    this.logger.info({ taskRunId, actingAgentId }, "Attempting to destroy task run");
    this.ac.checkPermission(taskRunId, actingAgentId, WRITE_ONLY_ACCESS);

    const taskRun = this.taskRuns.get(taskRunId);
    if (!taskRun) {
      this.logger.error({ taskRunId }, "Task run not found for destruction");
      throw new Error(`Task run with ID '${taskRunId}' not found`);
    }

    if (taskRun.status === "EXECUTING") {
      this.logger.debug({ taskRunId }, "Stopping executing task before removal");
      this.stopTaskRun(taskRunId, actingAgentId);
    }

    if (taskRun.isOccupied) {
      this.logger.debug({ taskRunId }, "Releasing task occupancy before removal");
      this.releaseTaskRunOccupancy(taskRunId, actingAgentId);
    }

    const {
      config: { taskKind, taskType, taskConfigVersion },
    } = taskRun;

    // Remove from pool if it's in one
    const poolSet = this.getTaskTypeVersionSet(taskKind, taskType, taskConfigVersion);
    if (poolSet) {
      poolSet.delete(taskRunId);
      this.logger.trace(
        {
          taskRunId,
          taskKind,
          taskType,
          taskConfigVersion,
        },
        "Removed task run from pool",
      );
    } else {
      throw new Error(`Missing pool`);
    }

    if (!poolSet.size) {
      // Remove pool version array set item
      const poolVersionSetsArray = this.getTaskTypeVersionSetsArray(taskKind, taskType)!;
      const poolVersionSet = poolVersionSetsArray.findIndex((it) => it[0] === taskConfigVersion);
      poolVersionSetsArray.splice(poolVersionSet, 1);
    }

    this.taskRuns.delete(taskRunId);
    this.logger.info(
      {
        taskKind,
        taskType,
        taskConfigVersion,
      },
      "Task run destroyed successfully",
    );

    this.stateLogger.logTaskRunDestroy({
      taskRunId,
    });

    const [poolStats, versions] = this.getPoolStats(taskKind, taskType, actingAgentId);
    this.stateLogger.logPoolChange({
      taskTypeId: taskSomeIdToTypeValue(taskRun),
      poolStats,
      versions,
    });
  }

  private setTaskRunAwaitingAgent(taskRunId: TaskRunIdValue) {
    this.logger.info({ taskRunId }, "Setting task run awaiting agent");

    const taskRun = this.getTaskRun(taskRunId, TASK_MANAGER_USER);
    if (taskRun.status === TaskRunStatusEnumSchema.enum.AWAITING_AGENT) {
      this.logger.debug({ taskRunId }, "It's already awaiting - skip");
      return;
    }

    this._updateTaskRun(taskRunId, taskRun, {
      status: TaskRunStatusEnumSchema.enum.AWAITING_AGENT,
    });

    this.awaitingTasksForAgents.push({
      taskRunId,
      agentTypeId: agentSomeIdToTypeValue({
        agentKind: taskRun.config.agentKind,
        agentType: taskRun.config.agentType,
        agentConfigVersion: taskRun.config.agentVersion,
      }),
    });
  }

  /**
   * Sets task as occupied.
   * Only authorized agents can occupy tasks.
   */
  private setTaskRunOccupied(taskRunId: TaskRunIdValue, actingAgentId: AgentIdValue): boolean {
    this.logger.info({ taskRunId, agentId: actingAgentId }, "Setting task run as occupied");
    this.ac.createPermissions(taskRunId, actingAgentId, FULL_ACCESS, TASK_MANAGER_USER);

    const taskRun = this.getTaskRun(taskRunId, actingAgentId);
    if (taskRun.isOccupied) {
      this.logger.debug(
        {
          taskRunId,
          exists: !!taskRun,
        },
        "Task not available for occupancy",
      );
      return false;
    }

    const occupiedSince = new Date();
    this._updateTaskRun(taskRunId, taskRun, {
      isOccupied: true,
      occupiedSince,
      currentAgentId: actingAgentId,
    });

    const assignment = clone(omit(taskRun, ["intervalId"]));

    this.agentStateLogger.logTaskAssigned({
      agentId: actingAgentId,
      assignment,
      assignmentId: taskRunId,
      assignedSince: occupiedSince,
    });

    if (this.options.occupancyTimeoutMs) {
      this.logger.debug(
        {
          taskRunId,
          timeoutMs: this.options.occupancyTimeoutMs,
        },
        "Setting occupancy timeout",
      );
      setTimeout(() => {
        this.releaseTaskRunOccupancy(taskRunId, actingAgentId);
      }, this.options.occupancyTimeoutMs);
    }

    this.logger.info({ taskRunId, actingAgentId }, "Task occupied successfully");
    return true;
  }

  /**
   * Releases task run occupancy.
   * Only the current agent or owners can release occupancy.
   */
  private releaseTaskRunOccupancy(taskRunId: TaskRunIdValue, actingAgentId: AgentIdValue): boolean {
    this.logger.info({ taskRunId, agentId: actingAgentId }, "Releasing task occupancy");

    const taskRun = this.getTaskRun(taskRunId, actingAgentId);
    if (!taskRun || !taskRun.isOccupied) {
      this.logger.debug({ taskRunId, exists: !!taskRun }, "Task not available for release");
      return false;
    }

    const unassignedAt = new Date();
    this._updateTaskRun(taskRunId, taskRun, {
      isOccupied: false,
      occupiedSince: null,
      currentAgentId: null,
    });

    this.ac.removePermissions(taskRunId, actingAgentId, TASK_MANAGER_USER);

    this.agentStateLogger.logTaskUnassigned({
      agentId: actingAgentId,
      assignmentId: taskRunId,
      unassignedAt,
    });

    this.logger.info({ taskRunId }, "Task occupancy released successfully");
    return true;
  }

  agentAvailable(
    agentKind: AgentKindEnum,
    agentType: AgentTypeValue,
    agentConfigVersion: AgentConfigVersionValue,
    availableCount: number,
  ) {
    if (!this.agentAvailable.length) {
      return;
    }
    let rest = availableCount;
    let index = 0;
    const awaitingTasks = clone(this.awaitingTasksForAgents);
    for (const { taskRunId, agentTypeId } of awaitingTasks) {
      if (agentTypeId !== agentSomeIdToTypeValue({ agentKind, agentType, agentConfigVersion })) {
        index++;
        continue;
      }
      this.awaitingTasksForAgents.splice(index, 1);
      this.scheduleStartTaskRun(taskRunId, TASK_MANAGER_USER);
      rest--;
      if (!rest) {
        return;
      }
      index++;
    }
  }

  /**
   * Update task status
   */
  updateTaskRun(
    taskRunId: TaskRunIdValue,
    update: Partial<Pick<TaskRun, "taskRunInput">>,
    actingAgentId: AgentIdValue,
  ) {
    this.logger.info({ taskRunId, actingAgentId, update }, "Updating task status");
    const status = this.getTaskRun(taskRunId, actingAgentId, WRITE_ONLY_ACCESS);
    return this._updateTaskRun(taskRunId, status, update);
  }

  // Just for auditlog
  private _updateTaskRun(
    taskRunId: TaskRunIdValue,
    taskRun: TaskRun,
    update: Partial<TaskRun>,
  ): TaskRun {
    updateDeepPartialObject(taskRun, update);
    this.stateLogger.logTaskRunUpdate({ taskRunId, taskRun: update });
    if (update.status) {
      const { taskKind, taskType } = taskRun;
      const [poolStats, versions] = this.getPoolStats(taskKind, taskType, TASK_MANAGER_USER);
      this.stateLogger.logPoolChange({
        taskTypeId: taskSomeIdToTypeValue({ taskKind, taskType }),
        poolStats,
        versions,
      });
    }
    return taskRun;
  }

  /**
   * Gets all task runs visible to the agent.
   */
  getAllTaskRuns(agentId: AgentIdValue): TaskRun[] {
    this.logger.info({ agentId }, "Getting all task runs");

    const taskRuns = Array.from(this.taskRuns.values()).filter((taskRun) =>
      this.ac.hasPermission(taskRun.taskRunId, agentId, READ_ONLY_ACCESS),
    );

    this.logger.debug({ agentId, count: taskRuns.length }, "Retrieved task runs");
    return taskRuns;
  }

  /**
   * Checks if a task is currently occupied.
   */
  isTaskRunOccupied(taskRunId: TaskRunIdValue, agentId: AgentIdValue): boolean {
    this.logger.debug({ taskRunId, agentId }, "Checking task occupancy");
    this.ac.checkPermission(taskRunId, agentId, READ_ONLY_ACCESS);

    const task = this.taskRuns.get(taskRunId);
    if (!task) {
      this.logger.error({ taskRunId }, "Task not found");
      throw new Error(`Undefined taskRunId: ${taskRunId}`);
    }

    return task.isOccupied;
  }

  /**
   * Executes a task with retry logic and records history.
   * @private
   */
  private async executeTask(taskRunId: TaskRunIdValue, actingAgentId: AgentIdValue): Promise<void> {
    this.logger.info({ taskRunId, agentId: actingAgentId }, "Executing task");
    this.ac.checkPermission(taskRunId, actingAgentId, READ_EXECUTE_ACCESS);

    const taskRun = this.getTaskRun(taskRunId, actingAgentId);
    const retryAttempt = taskRun.currentRetryAttempt;
    if (retryAttempt > 0) {
      this.logger.debug({ retryAttempt, maxRetries: taskRun.config.maxRetries }, "Retry attempt");
      if (!!taskRun.config.maxRetries && retryAttempt >= taskRun.config.maxRetries) {
        this.logger.warn({ taskRunId }, "Last retry attempt");
      }
    }

    if (taskRun.status === "COMPLETED" || taskRun.isOccupied) {
      this.logger.debug(
        {
          taskRunId,
          reason: taskRun.status === "COMPLETED" ? "completed" : "occupied",
        },
        "Skipping task execution",
      );
      return;
    }
    const startAt = new Date();
    const startTime = startAt.getTime();

    this._updateTaskRun(taskRunId, taskRun, {
      status: "EXECUTING",
      startRunAt: startAt,
      lastRunAt: startAt,
      nextRunAt:
        taskRun.config.maxRepeats != null && taskRun.completedRuns < taskRun.config.maxRepeats
          ? new Date(Date.now() + taskRun.config.intervalMs)
          : undefined,
    });

    this.logger.debug(
      {
        taskRunId,
        lastRunAt: taskRun.lastRunAt,
        nextRunAt: taskRun.nextRunAt,
      },
      "Executing task callback",
    );

    await this.onTaskStart(taskRun, this, {
      onAwaitingAgentAcquired(taskRunId, taskManager) {
        taskManager.setTaskRunAwaitingAgent(taskRunId);
      },
      onAgentAcquired(taskRunId, agentId, taskManager) {
        taskManager.setTaskRunOccupied(taskRunId, agentId);
      },
      onAgentComplete(output, taskRunId, agentId, taskManager) {
        const taskRun = taskManager.getTaskRun(taskRunId, agentId, READ_WRITE_ACCESS);
        taskManager._updateTaskRun(taskRunId, taskRun, {
          completedRuns: taskRun.completedRuns + 1,
        });

        // Record history entry
        taskManager.addHistoryEntry(taskRunId, agentId, {
          timestamp: new Date(),
          terminalStatus: "COMPLETED",
          output,
          runNumber: taskRun.completedRuns,
          maxRuns: taskRun.config.maxRepeats,
          retryAttempt: taskRun.currentRetryAttempt,
          maxRepeats: taskRun.config.maxRepeats,
          agentId: agentId,
          executionTimeMs: Date.now() - startTime,
        });

        taskManager.logger.debug(
          {
            taskRunId,
            completedRuns: taskRun.completedRuns,
            maxRuns: taskRun.config.maxRepeats,
          },
          "Task executed successfully",
        );

        // Check if we've reached maxRuns
        if (
          !taskRun.config.maxRepeats ||
          (taskRun.config.maxRepeats && taskRun.completedRuns >= taskRun.config.maxRepeats)
        ) {
          taskManager.stopTaskRun(taskRunId, agentId);
          taskManager.logger.info(
            {
              taskRunId,
              completedRuns: taskRun.completedRuns,
              maxRuns: taskRun.config.maxRepeats,
            },
            "Task reached maximum runs and has been stopped",
          );
        } else {
          taskManager.releaseTaskRunOccupancy(taskRunId, agentId);
        }
      },
      async onAgentError(err, taskRunId, agentId, taskManager) {
        let error;
        if (err instanceof FrameworkError) {
          error = err.explain();
        } else {
          error = err instanceof Error ? err.message : String(err);
        }

        const taskRun = taskManager.getTaskRun(taskRunId, agentId);
        taskManager._updateTaskRun(taskRunId, taskRun, {
          errorCount: taskRun.errorCount + 1,
          completedRuns: taskRun.completedRuns + 1,
        });
        const retryAttempt = taskRun.currentRetryAttempt;

        // Record history entry
        taskManager.addHistoryEntry(taskRunId, agentId, {
          timestamp: new Date(),
          terminalStatus: "FAILED",
          error,
          runNumber: taskRun.completedRuns,
          maxRuns: taskRun.config.maxRepeats,
          retryAttempt,
          maxRepeats: taskRun.config.maxRepeats,
          agentId: agentId,
          executionTimeMs: Date.now() - startTime,
        });

        taskManager.logger.error(
          {
            taskRunId,
            runNumber: taskRun.completedRuns,
            maxRuns: taskRun.config.maxRepeats,
            retryAttempt,
            maxRepeats: taskRun.config.maxRepeats,
            errorCount: taskRun.errorCount,
            error,
          },
          `Task execution failed ${error}`,
        );

        if (taskManager.options.errorHandler) {
          taskManager.options.errorHandler(err as Error, taskRunId);
        }

        taskManager.logger.debug({ taskRunId }, "Releasing task occupancy before removal");
        taskManager.releaseTaskRunOccupancy(taskRunId, agentId);
        if (taskRun.config.maxRepeats) {
          if (retryAttempt >= taskRun.config.maxRepeats) {
            taskManager.stopTaskRun(taskRunId, taskRun.config.ownerAgentId);
          } else {
            taskManager._updateTaskRun(taskRunId, taskRun, {
              currentRetryAttempt: retryAttempt + 1,
            });
          }
        }
      },
    });
  }

  /**
   * Add a history entry for a task
   * @private
   */
  private addHistoryEntry(
    taskRunId: TaskRunIdValue,
    actingAgentId: AgentIdValue,
    entry: TaskRunHistoryEntry,
  ): void {
    const taskRun = this.getTaskRun(taskRunId, actingAgentId);
    taskRun.history.push(entry);
    this.stateLogger.logTaskHistoryEntryCreate({ taskRunId, entry });
    this.agentStateLogger.logTaskHistoryEntry({
      agentId: actingAgentId,
      entry,
      assignmentId: taskRunId,
    });

    // Trim history if it exceeds maximum entries
    const maxEntries = taskRun.maxHistoryEntries ?? this.options.maxHistoryEntries;
    if (maxEntries && taskRun.history.length > maxEntries) {
      taskRun.history = taskRun.history.slice(-maxEntries);
    }
  }

  /**
   * Gets task history entries
   * Agents can only view history for their authorized tasks
   */
  getTaskRunHistory(
    taskRunId: TaskRunIdValue,
    actingAgentId: AgentIdValue,
    options: {
      limit?: number;
      startDate?: Date;
      endDate?: Date;
      status?: TaskRunTerminalStatusEnum;
    } = {},
  ): TaskRunHistoryEntry[] {
    this.logger.trace(
      {
        taskRunId,
        agentId: actingAgentId,
        options,
      },
      "Getting task history",
    );
    this.ac.checkPermission(taskRunId, actingAgentId, READ_ONLY_ACCESS);

    const taskRun = this.getTaskRun(taskRunId, actingAgentId);
    let history = taskRun.history;

    // Apply filters
    if (options.startDate) {
      history = history.filter((entry) => entry.timestamp >= options.startDate!);
    }
    if (options.endDate) {
      history = history.filter((entry) => entry.timestamp <= options.endDate!);
    }
    if (options.status) {
      history = history.filter((entry) => entry.terminalStatus === status);
    }
    if (options.limit) {
      history = history.slice(-options.limit);
    }

    return history;
  }

  destroy() {
    this.logger.debug("Destroy");
    if (this.taskStartIntervalId) {
      clearInterval(this.taskStartIntervalId);
      this.taskStartIntervalId = null;
    }
  }
}
