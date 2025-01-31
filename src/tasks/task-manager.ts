import { z } from "zod";
import { Logger } from "bee-agent-framework/logger/logger";
import { AgentKindSchema } from "src/agents/agent-registry.js";

export const TaskConfigSchema = z
  .object({
    id: z.string().describe("Unique identifier for the task"),
    input: z.string().describe("Input data for the task."),
    description: z.string().describe("Detail information about the task and its context."),
    intervalMs: z.number().describe("Interval between task executions in milliseconds"),
    runImmediately: z.boolean().describe("Whether to run the task immediately upon starting"),
    maxRetries: z
      .number()
      .describe("Maximum number of retry attempts if task execution fails")
      .nullish(),
    retryDelayMs: z.number().describe("Delay between retry attempts in milliseconds").nullish(),
    ownerAgentId: z.string().describe("Identifier of who owns/manages this task"),
    agentKind: AgentKindSchema,
    agentType: z.string().describe("Agent type that is allowed to execute this task"),
    maxRuns: z
      .number()
      .describe("Maximum number of times this task should execute. Undefined means infinite runs."),
  })
  .describe("Represents a periodic task configuration.");

export type TaskConfig = z.infer<typeof TaskConfigSchema>;

export const TaskHistoryEntrySchema = z
  .object({
    timestamp: z.date().describe("When this task execution occurred"),
    success: z.boolean().describe("Whether the execution was successful"),
    output: z.unknown().describe("Output produced by the task callback"),
    error: z.string().optional().describe("Error message if execution failed"),
    runNumber: z.number().describe("Which run number this was (1-based)"),
    retryCount: z.number().describe("How many retries were needed for this execution"),
    agentId: z.string().optional().describe("ID of agent that executed the task, if occupied"),
    executionTimeMs: z.number().describe("How long the task execution took in milliseconds"),
  })
  .describe("Records details about a single execution of a task");

export type TaskHistoryEntry = z.infer<typeof TaskHistoryEntrySchema>;

// Update existing TaskStatus schema to include history
export const TaskStatusSchema = z
  .object({
    id: z
      .string()
      .min(1, "Task ID cannot be empty")
      .describe("Unique identifier matching the corresponding AgentTask"),
    isRunning: z
      .boolean()
      .describe(
        "Indicates if the task is currently scheduled and actively running its periodic execution",
      ),
    isOccupied: z
      .boolean()
      .describe("Indicates if the task is currently being operated on by an agent"),
    occupiedSince: z
      .date()
      .optional()
      .describe("Timestamp when the task was marked as occupied. undefined if not occupied"),
    lastRunAt: z.date().optional().describe("Timestamp of the last successful execution"),
    nextRunAt: z.date().optional().describe("Expected timestamp of the next scheduled execution"),
    errorCount: z.number().int().describe("Count of consecutive execution failures"),
    ownerAgentId: z.string().describe("ID of the agent who owns/manages this task"),
    currentAgentId: z
      .string()
      .optional()
      .describe("ID of the agent currently operating on the task. undefined if not occupied"),
    completedRuns: z
      .number()
      .int()
      .describe("Number of times this task has been successfully executed"),
    isCompleted: z.boolean().describe("Indicates if the task has reached its maximum allowed runs"),
    history: z.array(TaskHistoryEntrySchema).describe("History of task executions"),
    maxHistoryEntries: z
      .number()
      .optional()
      .describe("Maximum number of history entries to keep. Undefined means keep all history."),
  })
  .describe("Represents the current status and execution state of a task");

export type TaskStatus = z.infer<typeof TaskStatusSchema>;

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
    {
      intervalId: NodeJS.Timeout | null;
      status: TaskStatus;
      config: TaskConfig;
    }
  >();

  constructor(
    private callback: (task: TaskConfig) => Promise<unknown>,
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
      successOnly?: boolean;
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
    if (options.successOnly) {
      history = history.filter((entry) => entry.success);
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
      task.config.agentType === agentId || this.hasOwnerPermission(taskId, agentId);
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
      isRunning: false,
      isOccupied: false,
      errorCount: 0,
      ownerAgentId: task.ownerAgentId,
      completedRuns: 0,
      isCompleted: false,
      history: [],
    };

    this.tasks.set(task.id, {
      intervalId: null,
      status,
      config: task,
    });

    this.logger.info("Task scheduled successfully", { taskId: task.id });
  }

  /**
   * Starts a task.
   * Only owners and admins can start/stop tasks.
   */
  async startTask(taskId: string, agentId: string): Promise<void> {
    this.logger.info("Starting task", { taskId, agentId });

    const task = this.tasks.get(taskId);
    if (!task) {
      this.logger.error("Task not found", { taskId });
      throw new Error(`Task ${taskId} not found`);
    }

    if (!this.hasOwnerPermission(taskId, agentId)) {
      this.logger.error("Permission denied for starting task", { taskId, agentId });
      throw new PermissionError(
        `Agent ${agentId} does not have permission to start task ${taskId}`,
      );
    }

    if (task.status.isRunning) {
      this.logger.warn("Task already running", { taskId });
      throw new Error(`Task ${taskId} is already running`);
    }

    task.status.isRunning = true;
    task.status.nextRunAt = new Date(Date.now() + task.config.intervalMs);

    if (task.config.runImmediately) {
      this.logger.debug("Executing task immediately", { taskId });
      await this.executeTask(taskId);
    }

    if (!task.status.isCompleted) {
      this.logger.debug("Setting up task interval", { taskId, intervalMs: task.config.intervalMs });
      task.intervalId = setInterval(async () => {
        await this.executeTask(taskId);
      }, task.config.intervalMs);
    }

    this.logger.info("Task started successfully", { taskId });
  }

  /**
   * Stops a task.
   * Only owners and admins can start/stop tasks.
   */
  stopTask(taskId: string, agentId: string): void {
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

    if (!task.status.isRunning) {
      this.logger.debug("Task already stopped", { taskId });
      return;
    }

    if (task.intervalId) {
      this.logger.debug("Clearing task interval", { taskId });
      clearInterval(task.intervalId);
      task.intervalId = null;
    }

    task.status.isRunning = false;
    task.status.nextRunAt = undefined;
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

    if (task.status.isRunning) {
      this.logger.debug("Stopping running task before removal", { taskId });
      this.stopTask(taskId, agentId);
    }

    if (task.status.isOccupied) {
      this.logger.debug("Releasing task occupancy before removal", { taskId });
      this.releaseTaskOccupancy(taskId, agentId);
    }

    this.tasks.delete(taskId);
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

    task.status.isOccupied = true;
    task.status.occupiedSince = new Date();
    task.status.currentAgentId = agentId;

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

    if (task.status.currentAgentId !== agentId && !this.hasOwnerPermission(taskId, agentId)) {
      this.logger.error("Permission denied for releasing task occupancy", { taskId, agentId });
      throw new PermissionError(`Agent ${agentId} cannot release occupancy of task ${taskId}`);
    }

    task.status.isOccupied = false;
    task.status.occupiedSince = undefined;
    task.status.currentAgentId = undefined;

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
  private async executeTask(taskId: string, retryCount = 0): Promise<void> {
    this.logger.debug("Executing task", { taskId, retryCount });

    const task = this.tasks.get(taskId);
    if (!task) {
      this.logger.warn("Task not found for execution", { taskId });
      return;
    }

    if (task.status.isCompleted || task.status.isOccupied) {
      this.logger.debug("Skipping task execution", {
        taskId,
        reason: task.status.isCompleted ? "completed" : "occupied",
      });
      return;
    }

    const startTime = Date.now();
    let success = false;
    let output: unknown;
    let error: string | undefined;

    try {
      task.status.lastRunAt = new Date();
      task.status.nextRunAt = new Date(Date.now() + task.config.intervalMs);

      this.logger.debug("Executing task callback", {
        taskId,
        lastRunAt: task.status.lastRunAt,
        nextRunAt: task.status.nextRunAt,
      });

      output = await this.callback(task.config);
      success = true;

      task.status.errorCount = 0;
      task.status.completedRuns++;

      this.logger.debug("Task executed successfully", {
        taskId,
        completedRuns: task.status.completedRuns,
        maxRuns: task.config.maxRuns,
      });

      // Check if we've reached maxRuns
      if (task.config.maxRuns && task.status.completedRuns >= task.config.maxRuns) {
        task.status.isCompleted = true;
        this.stopTask(taskId, task.config.ownerAgentId);
        this.logger.info("Task reached maximum runs and has been stopped", {
          taskId,
          completedRuns: task.status.completedRuns,
          maxRuns: task.config.maxRuns,
        });
      }
    } catch (err) {
      task.status.errorCount++;
      error = err instanceof Error ? err.message : String(err);

      this.logger.error("Task execution failed", {
        taskId,
        retryCount,
        maxRetries: task.config.maxRetries,
        errorCount: task.status.errorCount,
        error,
      });

      if (this.options.errorHandler) {
        this.options.errorHandler(err as Error, taskId);
      }

      if (retryCount < (task.config.maxRetries ?? 0)) {
        const retryDelay = task.config.retryDelayMs ?? 0;
        this.logger.debug("Retrying task execution", {
          taskId,
          retryCount,
          nextRetryDelay: retryDelay,
        });

        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        await this.executeTask(taskId, retryCount + 1);
        return; // Don't record history for failed attempts that will be retried
      } else {
        this.logger.warn("Task exceeded maximum retry attempts", {
          taskId,
          maxRetries: task.config.maxRetries,
          errorCount: task.status.errorCount,
        });
      }
    }

    // Record history entry
    this.addHistoryEntry(taskId, {
      timestamp: new Date(),
      success,
      output,
      error,
      runNumber: task.status.completedRuns,
      retryCount,
      agentId: task.status.currentAgentId,
      executionTimeMs: Date.now() - startTime,
    });
  }
}
