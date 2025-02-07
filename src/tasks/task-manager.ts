import { FrameworkError } from "bee-agent-framework";
import { Logger } from "bee-agent-framework/logger/logger";
import { AgentKindSchema } from "src/agents/agent-registry.js";
import { getTaskStateLogger } from "src/tasks/task-state-logger.js";
import { updateDeepPartialObject } from "src/utils/objects.js";
import { z } from "zod";

export const TaskConfigSchema = z
  .object({
    id: z.string().describe("Unique identifier for the task"),
    input: z.string().describe("Input data for the task."),
    description: z.string().describe("Detail information about the task and its context."),
    intervalMs: z.number().describe("Interval between task executions in milliseconds"),
    runImmediately: z.boolean().describe("Whether to run the task immediately upon starting"),
    maxRetries: z
      .number()
      .describe(
        "Maximum number of retry attempts if task execution fails. undefined if no retries.",
      )
      .nullish(),
    retryDelayMs: z.number().describe("Delay between retry attempts in milliseconds").nullish(),
    ownerAgentId: z.string().describe("Identifier of who owns/manages this task"),
    agentKind: AgentKindSchema,
    agentType: z.string().describe("Agent type that is allowed to execute this task"),
    maxRuns: z
      .number()
      .describe("Maximum number of times this task should execute. undefined if infinite runs.")
      .nullish(),
  })
  .describe("Represents a periodic task configuration.");

export type TaskConfig = z.infer<typeof TaskConfigSchema>;

export const TaskTerminalStatusEnumSchema = z.enum(["STOPPED", "FAILED", "COMPLETED"]);
export type TaskTerminalStatusEnum = z.infer<typeof TaskTerminalStatusEnumSchema>;

export const TaskHistoryEntrySchema = z
  .object({
    timestamp: z.date().describe("When this task execution occurred"),
    terminalStatus: TaskTerminalStatusEnumSchema,
    output: z.unknown().describe("Output produced by the task callback"),
    error: z.string().optional().describe("Error message if execution failed"),
    runNumber: z.number().describe("Which run number this was (1-based)"),
    maxRuns: z
      .number()
      .describe("Maximum number of times this task should execute. Undefined means infinite runs.")
      .nullish(),
    retryAttempt: z.number().describe("How many retries were needed for this execution"),
    maxRetries: z
      .number()
      .describe(
        "Maximum number of retry attempts if task execution fails. undefined if no retries.",
      )
      .nullish(),
    agentId: z.string().optional().describe("ID of agent that executed the task, if occupied"),
    executionTimeMs: z.number().describe("How long the task execution took in milliseconds"),
  })
  .describe("Records details about a single execution of a task");

export type TaskHistoryEntry = z.infer<typeof TaskHistoryEntrySchema>;

export const TaskStatusEnumSchema = z.enum([
  "SCHEDULED",
  "RUNNING",
  "WAITING",
  "STOPPED",
  "FAILED",
  "COMPLETED",
  "REMOVED",
]);
export type TaskStatusEnum = z.infer<typeof TaskStatusEnumSchema>;

// Update existing TaskStatus schema to include history
export const TaskStatusSchema = z
  .object({
    id: z
      .string()
      .min(1, "Task ID cannot be empty")
      .describe("Unique identifier matching the corresponding AgentTask"),
    status: TaskStatusEnumSchema.describe("The status of the task."),
    isOccupied: z
      .boolean()
      .describe("Indicates if the task is currently being operated on by an agent"),
    occupiedSince: z
      .date()
      .optional()
      .nullable()
      .describe("Timestamp when the task was marked as occupied. undefined if not occupied"),
    startRunAt: z.date().optional().describe("Timestamp of the execution start."),
    lastRunAt: z.date().optional().describe("Timestamp of the last successful execution"),
    nextRunAt: z.date().optional().describe("Expected timestamp of the next scheduled execution"),
    errorCount: z.number().int().describe("Count of consecutive execution failures"),
    currentRetryAttempt: z
      .number()
      .describe("Current retry count. Maximum retries configured via maxRetries"),
    ownerAgentId: z.string().describe("ID of the agent who owns/manages this task"),
    currentAgentId: z
      .string()
      .optional()
      .nullable()
      .describe("ID of the agent currently operating on the task. undefined if not occupied"),
    completedRuns: z
      .number()
      .int()
      .describe("Number of times this task has been successfully executed"),
    history: z.array(TaskHistoryEntrySchema).describe("History of task executions"),
    maxHistoryEntries: z
      .number()
      .optional()
      .describe("Maximum number of history entries to keep. Undefined means keep all history."),
  })
  .describe("Represents the current status and execution state of a task");

export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskSchema = z
  .object({
    id: z.string().describe("Unique identifier for the task"),
    status: TaskStatusSchema,
    config: TaskConfigSchema,
  })
  .describe("Represents a periodic task configuration.");
export type Task = z.infer<typeof TaskSchema>;

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}

export class TaskManager {
  private readonly logger: Logger;
  private tasks = new Map<
    string,
    Task & {
      intervalId: NodeJS.Timeout | null;
    }
  >();
  private removedTasks: Task[] = [];
  private scheduledTasksToStart: { taskId: string; agentId: string }[] = [];
  private taskStartIntervalId: NodeJS.Timeout | null = null;

  constructor(
    private onTaskStart: (
      task: TaskConfig,
      taskManager: TaskManager,
      callbacks: {
        onAgentCreate: (taskId: string, agentId: string, taskManage: TaskManager) => void;
        onAgentComplete: (
          output: string,
          taskId: string,
          agentId: string,
          taskManage: TaskManager,
        ) => void;
        onAgentError: (
          err: Error,
          taskId: string,
          agentId: string,
          taskManage: TaskManager,
        ) => void;
      },
    ) => Promise<unknown>,
    private options: {
      errorHandler?: (error: Error, taskId: string) => void;
      occupancyTimeoutMs?: number;
      adminIds?: string[];
      maxHistoryEntries?: number;
    } = {},
  ) {
    this.logger = Logger.root.child({ name: "TaskManager" });
    this.logger.info("Initializing TaskManager");

    this.options = {
      errorHandler: (error: Error, taskId: string) => {
        this.logger.error("Task error occurred", { taskId, error });
      },
      occupancyTimeoutMs: 30 * 60 * 1000,
      adminIds: [],
      maxHistoryEntries: 100, // Default to keeping last 100 entries
      ...options,
    };

    this.taskStartIntervalId = setInterval(async () => {
      try {
        await this.processNextStartTask(); // Your async function
      } catch (err) {
        this.logger.error("Process next start task error", err);
      }
    }, 100); // Runs every 100ms (0.1 second)
  }

  /**
   * Add a history entry for a task
   * @private
   */
  private addHistoryEntry(taskId: string, entry: TaskHistoryEntry): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      return;
    }
    getTaskStateLogger().logHistoryEntry(taskId, entry);

    task.status.history.push(entry);

    // Trim history if it exceeds maximum entries
    const maxEntries = task.status.maxHistoryEntries ?? this.options.maxHistoryEntries;
    if (maxEntries && task.status.history.length > maxEntries) {
      task.status.history = task.status.history.slice(-maxEntries);
    }
  }

  /**
   * Gets task history entries
   * Agents can only view history for their authorized tasks
   */
  getTaskHistory(
    taskId: string,
    agentId: string,
    options: {
      limit?: number;
      startDate?: Date;
      endDate?: Date;
      status?: TaskTerminalStatusEnum;
    } = {},
  ): TaskHistoryEntry[] {
    this.logger.trace("Getting task history", { taskId, agentId, options });

    if (!this.hasAgentPermission(taskId, agentId)) {
      this.logger.error("Permission denied for viewing task history", { taskId, agentId });
      throw new PermissionError(`Agent ${agentId} does not have permission to view task ${taskId}`);
    }

    const task = this.tasks.get(taskId);
    if (!task) {
      this.logger.error("Task not found", { taskId });
      throw new Error(`Task ${taskId} not found`);
    }

    let history = task.status.history;

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

  /**
   * Checks if an agent has owner-level permissions for a task
   */
  private hasOwnerPermission(taskId: string, agentId: string): boolean {
    this.logger.trace("Checking owner permission", { taskId, agentId });

    const task = this.tasks.get(taskId);
    if (!task) {
      this.logger.debug("Task not found for permission check", { taskId });
      return false;
    }

    const hasPermission =
      task.config.ownerAgentId === agentId || this.options.adminIds?.includes(agentId) || false;
    this.logger.debug("Owner permission check result", { taskId, agentId, hasPermission });
    return hasPermission;
  }

  /**
   * Checks if an agent has execution permissions for a task
   */
  private hasAgentPermission(taskId: string, agentId: string): boolean {
    this.logger.trace("Checking agent permission", { taskId, agentId });

    const task = this.tasks.get(taskId);
    if (!task) {
      this.logger.debug("Task not found for permission check", { taskId });
      return false;
    }

    const hasPermission =
      agentId.includes(`:${task.config.agentType}[`) || this.hasOwnerPermission(taskId, agentId);
    this.logger.debug("Agent permission check result", { taskId, agentId, hasPermission });
    return hasPermission;
  }

  /**
   * Schedules a new task.
   * Only owners and admins can schedule tasks.
   */
  scheduleTask(task: TaskConfig, agentId: string): void {
    this.logger.info("Scheduling new task", { taskId: task.id, agentId });

    if (task.ownerAgentId !== agentId && !this.options.adminIds?.includes(agentId)) {
      this.logger.error("Permission denied for task scheduling", {
        taskId: task.id,
        agentId,
        ownerAgentId: task.ownerAgentId,
      });
      throw new PermissionError(
        `Agent ${agentId} cannot create task with owner ${task.ownerAgentId}`,
      );
    }

    if (this.tasks.has(task.id)) {
      this.logger.error("Task already exists", { taskId: task.id });
      throw new Error(`Task with id ${task.id} already exists`);
    }

    const status: TaskStatus = {
      id: task.id,
      status: "SCHEDULED",
      currentRetryAttempt: 0,
      isOccupied: false,
      errorCount: 0,
      ownerAgentId: task.ownerAgentId,
      completedRuns: 0,
      history: [],
    };

    getTaskStateLogger().logStatusChange(status.id, status);

    this.tasks.set(task.id, {
      id: task.id,
      intervalId: null,
      status,
      config: task,
    });

    getTaskStateLogger().logConfigCreate(task.id, task);

    this.logger.info("Task scheduled successfully", { taskId: task.id });
  }

  /**
   * Schedule task to start as soon as possible.
   * Only owners and admins can start/stop tasks.
   */
  scheduleTaskStart(taskId: string, agentId: string): void {
    this.logger.info("Schedule task start", { taskId, agentId });
    this.scheduledTasksToStart.push({ taskId, agentId });
  }

  async processNextStartTask() {
    if (!this.scheduledTasksToStart.length) {
      return;
    }
    const { taskId, agentId } = this.scheduledTasksToStart.shift()!;

    this.logger.info("Starting task", { taskId, agentId });

    const task = this.tasks.get(taskId);
    if (!task) {
      this.logger.error("Task not found", { taskId });
      throw new Error(`Task ${taskId} not found`);
    }
    const { status } = task;

    if (!this.hasOwnerPermission(taskId, agentId)) {
      this.logger.error("Permission denied for starting task", { taskId, agentId });
      throw new PermissionError(
        `Agent ${agentId} does not have permission to start task ${taskId}`,
      );
    }

    if (status.status === "RUNNING") {
      this.logger.warn("Task already running", { taskId });
      throw new Error(`Task ${taskId} is already running`);
    }

    this._updateTaskStatus(taskId, status, {
      status: "RUNNING",
      nextRunAt: new Date(Date.now() + task.config.intervalMs),
    });

    if (task.config.runImmediately) {
      this.logger.debug("Executing task immediately", { taskId });
      await this.executeTask(taskId);
    }

    if (!task.config.maxRuns || 1 < task.config.maxRuns) {
      this.logger.debug("Setting up task interval", { taskId, intervalMs: task.config.intervalMs });
      const self = this;
      task.intervalId = setInterval(async () => {
        await self.executeTask(taskId);
      }, task.config.intervalMs);

      status.status = "WAITING";

      this._updateTaskStatus(taskId, status, {
        status: "WAITING",
      });
    }

    this.logger.info("Task started successfully", { taskId });
  }

  /**
   * Stops a task.
   * Only owners and admins can start/stop tasks.
   */
  stopTask(taskId: string, agentId: string, isCompleted = false): void {
    this.logger.info("Stopping task", { taskId, agentId });

    if (!this.hasOwnerPermission(taskId, agentId)) {
      this.logger.error("Permission denied for stopping task", { taskId, agentId });
      throw new PermissionError(`Agent ${agentId} does not have permission to stop task ${taskId}`);
    }

    const task = this.tasks.get(taskId);
    if (!task) {
      this.logger.error("Task not found", { taskId });
      throw new Error(`Task ${taskId} not found`);
    }
    const { status } = task;

    if (status.status === "STOPPED") {
      this.logger.debug("Task already stopped", { taskId });
      return;
    }

    if (task.intervalId) {
      this.logger.debug("Clearing task interval", { taskId });
      clearInterval(task.intervalId);
      task.intervalId = null;
    }

    if (status.isOccupied) {
      this.logger.debug("Releasing task occupancy before stop", { taskId });
      this.releaseTaskOccupancy(taskId, agentId);
    }

    this._updateTaskStatus(taskId, status, {
      status: isCompleted ? "COMPLETED" : "STOPPED",
      nextRunAt: undefined,
    });
    this.logger.info("Task stopped successfully", { taskId });
  }

  /**
   * Removes a task completely.
   * Only owners and admins can remove tasks.
   */
  removeTask(taskId: string, agentId: string): void {
    this.logger.info("Removing task", { taskId, agentId });

    if (!this.hasOwnerPermission(taskId, agentId)) {
      this.logger.error("Permission denied for removing task", { taskId, agentId });
      throw new PermissionError(
        `Agent ${agentId} does not have permission to remove task ${taskId}`,
      );
    }

    const task = this.tasks.get(taskId);
    if (!task) {
      this.logger.error("Task not found", { taskId });
      throw new Error(`Task ${taskId} not found`);
    }
    const { status } = task;

    if (status.status === "RUNNING") {
      this.logger.debug("Stopping running task before removal", { taskId });
      this.stopTask(taskId, agentId);
    }

    if (status.isOccupied) {
      this.logger.debug("Releasing task occupancy before removal", { taskId });
      this.releaseTaskOccupancy(taskId, agentId);
    }

    this._updateTaskStatus(taskId, status, { status: "REMOVED" });
    this.tasks.delete(taskId);
    this.removedTasks.push(task);
    this.logger.info("Task removed successfully", { taskId });
  }

  /**
   * Sets task as occupied.
   * Only authorized agents can occupy tasks.
   */
  setTaskOccupied(taskId: string, agentId: string): boolean {
    this.logger.info("Setting task as occupied", { taskId, agentId });

    if (!this.hasAgentPermission(taskId, agentId)) {
      this.logger.error("Permission denied for occupying task", { taskId, agentId });
      throw new PermissionError(`Agent ${agentId} is not authorized to operate on task ${taskId}`);
    }

    const task = this.tasks.get(taskId);
    if (!task || task.status.isOccupied) {
      this.logger.debug("Task not available for occupancy", { taskId, exists: !!task });
      return false;
    }
    const { status } = task;

    this._updateTaskStatus(taskId, status, {
      isOccupied: true,
      occupiedSince: new Date(),
      currentAgentId: agentId,
    });

    if (this.options.occupancyTimeoutMs) {
      this.logger.debug("Setting occupancy timeout", {
        taskId,
        timeoutMs: this.options.occupancyTimeoutMs,
      });
      setTimeout(() => {
        this.releaseTaskOccupancy(taskId, agentId);
      }, this.options.occupancyTimeoutMs);
    }

    this.logger.info("Task occupied successfully", { taskId, agentId });
    return true;
  }

  /**
   * Releases task occupancy.
   * Only the current agent or owners can release occupancy.
   */
  releaseTaskOccupancy(taskId: string, agentId: string): boolean {
    this.logger.info("Releasing task occupancy", { taskId, agentId });

    const task = this.tasks.get(taskId);
    if (!task || !task.status.isOccupied) {
      this.logger.debug("Task not available for release", { taskId, exists: !!task });
      return false;
    }
    const { status } = task;

    if (status.currentAgentId !== agentId && !this.hasOwnerPermission(taskId, agentId)) {
      this.logger.error("Permission denied for releasing task occupancy", { taskId, agentId });
      throw new PermissionError(`Agent ${agentId} cannot release occupancy of task ${taskId}`);
    }

    this._updateTaskStatus(taskId, status, {
      isOccupied: false,
      occupiedSince: null,
      currentAgentId: null,
    });

    this.logger.info("Task occupancy released successfully", { taskId });
    return true;
  }

  /**
   * Gets task status.
   * Agents can only view their authorized tasks.
   */
  getTaskStatus(taskId: string, agentId: string): TaskStatus {
    this.logger.trace("Getting task status", { taskId, agentId });

    const task = this.tasks.get(taskId);
    if (!task) {
      this.logger.error("Task not found", { taskId });
      throw new Error(`Undefined taskId: ${taskId}`);
    }

    if (!this.hasAgentPermission(taskId, agentId)) {
      this.logger.error("Permission denied for viewing task status", { taskId, agentId });
      throw new PermissionError(`Agent ${agentId} does not have permission to view task ${taskId}`);
    }

    return task.status;
  }

  /**
   * Update task status
   */
  updateTaskStatus(
    taskId: string,
    agentId: string,
    update: Partial<Pick<TaskStatus, "errorCount" | "completedRuns" | "currentRetryAttempt">>,
  ) {
    this.logger.trace("Updating task status", { taskId, agentId, update });
    const status = this.getTaskStatus(taskId, agentId);
    return this._updateTaskStatus(taskId, status, update);
  }

  // Just for auditlog
  private _updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    update: Partial<TaskStatus>,
  ): TaskStatus {
    updateDeepPartialObject(status, update);
    getTaskStateLogger().logStatusChange(taskId, update);
    return status;
  }

  /**
   * Gets all task statuses visible to the agent.
   */
  getAllTaskStatuses(agentId: string): TaskStatus[] {
    this.logger.trace("Getting all task statuses", { agentId });

    const statuses = Array.from(this.tasks.values())
      .filter((task) => this.hasAgentPermission(task.status.id, agentId))
      .map((task) => task.status);

    this.logger.debug("Retrieved task statuses", { agentId, count: statuses.length });
    return statuses;
  }

  /**
   * Checks if a task is currently occupied.
   */
  isTaskOccupied(taskId: string, agentId: string): boolean {
    this.logger.trace("Checking task occupancy", { taskId, agentId });

    const task = this.tasks.get(taskId);
    if (!task) {
      this.logger.error("Task not found", { taskId });
      throw new Error(`Undefined taskId: ${taskId}`);
    }

    if (!this.hasAgentPermission(taskId, agentId)) {
      this.logger.error("Permission denied for checking task occupancy", { taskId, agentId });
      throw new PermissionError(`Agent ${agentId} does not have permission to view task ${taskId}`);
    }

    return task.status.isOccupied;
  }

  /**
   * Executes a task with retry logic and records history.
   * @private
   */
  private async executeTask(taskId: string): Promise<void> {
    this.logger.debug("Executing task", { taskId });

    const task = this.tasks.get(taskId);
    if (!task) {
      this.logger.warn("Task not found for execution", { taskId });
      return;
    }
    const { status } = task;

    const retryAttempt = status.currentRetryAttempt;
    if (retryAttempt > 0) {
      this.logger.debug("Retry attempt", { retryAttempt, maxRetries: task.config.maxRetries });
      if (!!task.config.maxRetries && retryAttempt >= task.config.maxRetries) {
        this.logger.warn("Last retry attempt", { taskId });
      }
    }

    if (status.status === "COMPLETED" || status.isOccupied) {
      this.logger.debug("Skipping task execution", {
        taskId,
        reason: status.status === "COMPLETED" ? "completed" : "occupied",
      });
      return;
    }

    const startTime = Date.now();

    this._updateTaskStatus(taskId, status, {
      lastRunAt: new Date(),
      nextRunAt: new Date(Date.now() + task.config.intervalMs),
    });

    this.logger.debug("Executing task callback", {
      taskId,
      lastRunAt: status.lastRunAt,
      nextRunAt: status.nextRunAt,
    });

    await this.onTaskStart(task.config, this, {
      onAgentCreate(taskId, agentId, taskManager) {
        taskManager.setTaskOccupied(taskId, agentId);
      },
      onAgentComplete(output, taskId, agentId, taskManager) {
        const status = taskManager.getTaskStatus(taskId, agentId);
        taskManager.updateTaskStatus(taskId, agentId, {
          completedRuns: status.completedRuns + 1,
        });

        // Record history entry
        taskManager.addHistoryEntry(taskId, {
          timestamp: new Date(),
          terminalStatus: "COMPLETED",
          output,
          runNumber: task.status.completedRuns,
          maxRuns: task.config.maxRuns,
          retryAttempt: status.currentRetryAttempt,
          maxRetries: task.config.maxRetries,
          agentId: task.status.currentAgentId!,
          executionTimeMs: Date.now() - startTime,
        });

        taskManager.logger.debug("Task executed successfully", {
          taskId,
          completedRuns: task.status.completedRuns,
          maxRuns: task.config.maxRuns,
        });

        taskManager.releaseTaskOccupancy(taskId, agentId);
        // Check if we've reached maxRuns
        if (task.config.maxRuns && task.status.completedRuns >= task.config.maxRuns) {
          taskManager.stopTask(taskId, task.config.ownerAgentId);
          taskManager.logger.info("Task reached maximum runs and has been stopped", {
            taskId,
            completedRuns: task.status.completedRuns,
            maxRuns: task.config.maxRuns,
          });
        }
      },
      async onAgentError(err, taskId, agentId, taskManager) {
        let error;
        if (err instanceof FrameworkError) {
          error = err.explain();
        } else {
          error = err instanceof Error ? err.message : String(err);
        }

        const status = taskManager.getTaskStatus(taskId, agentId);
        taskManager.updateTaskStatus(taskId, agentId, {
          errorCount: status.errorCount + 1,
          completedRuns: task.status.completedRuns + 1,
        });
        const retryAttempt = status.currentRetryAttempt;

        // Record history entry
        taskManager.addHistoryEntry(taskId, {
          timestamp: new Date(),
          terminalStatus: "FAILED",
          error,
          runNumber: task.status.completedRuns,
          maxRuns: task.config.maxRuns,
          retryAttempt,
          maxRetries: task.config.maxRetries,
          agentId: task.status.currentAgentId!,
          executionTimeMs: Date.now() - startTime,
        });

        taskManager.logger.error(`Task execution failed ${error}`, {
          taskId,
          runNumber: task.status.completedRuns,
          maxRuns: task.config.maxRuns,
          retryAttempt,
          maxRetries: task.config.maxRetries,
          errorCount: task.status.errorCount,
          error,
        });

        if (taskManager.options.errorHandler) {
          taskManager.options.errorHandler(err as Error, taskId);
        }

        taskManager.logger.debug("Releasing task occupancy before removal", { taskId });
        taskManager.releaseTaskOccupancy(taskId, agentId);
        if (task.config.maxRetries) {
          if (retryAttempt >= task.config.maxRetries) {
            taskManager.stopTask(taskId, task.config.ownerAgentId);
          } else {
            taskManager.updateTaskStatus(taskId, task.config.ownerAgentId, {
              currentRetryAttempt: retryAttempt + 1,
            });
          }
        }
      },
    });
  }

  destroy() {
    this.logger.debug("Destroy");
    if (this.taskStartIntervalId) {
      clearInterval(this.taskStartIntervalId);
      this.taskStartIntervalId = null;
    }
  }
}
