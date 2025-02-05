import {
  BaseToolOptions,
  JSONToolOutput,
  Tool,
  ToolEmitter,
  ToolInput,
} from "bee-agent-framework/tools/base";
import { TaskConfigSchema, TaskHistoryEntry, TaskManager, TaskStatus } from "./task-manager.js";
import { Emitter } from "bee-agent-framework/emitter/emitter";
import { z } from "zod";

export interface TaskManagerToolInput extends BaseToolOptions {
  taskManager: TaskManager;
}

export type TaskManagerToolResultData =
  | void
  | boolean
  | TaskStatus
  | TaskStatus[]
  | TaskHistoryEntry[];

export interface TaskManagerToolResult {
  method: string;
  success: true;
  data: TaskManagerToolResultData;
}

export const ScheduleTaskSchema = z
  .object({
    method: z.literal("scheduleTask"),
    task: TaskConfigSchema,
    supervisorAgentId: z.string(),
  })
  .describe(
    "Creates a new task with specified configuration. Requires owner or admin permissions.",
  );

export const StartTaskSchema = z
  .object({
    method: z.literal("startTask"),
    taskId: z.string(),
    supervisorAgentId: z.string(),
  })
  .describe("Starts periodic execution of a task. Requires owner or admin permissions.");

export const StopTaskSchema = z
  .object({
    method: z.literal("stopTask"),
    taskId: z.string(),
    supervisorAgentId: z.string(),
  })
  .describe("Stops periodic execution of a task. Requires owner or admin permissions.");

export const RemoveTaskSchema = z
  .object({
    method: z.literal("removeTask"),
    taskId: z.string(),
    supervisorAgentId: z.string(),
  })
  .describe("Removes a task completely. Requires owner or admin permissions.");

export const GetTaskStatusSchema = z
  .object({
    method: z.literal("getTaskStatus"),
    taskId: z.string(),
    supervisorAgentId: z.string(),
  })
  .describe("Gets current status of a task. Requires agent permissions.");

export const GetAllTaskStatusesSchema = z
  .object({
    method: z.literal("getAllTaskStatuses"),
    supervisorAgentId: z.string(),
  })
  .describe("Gets status of all accessible tasks. Requires agent permissions.");

export const SetTaskOccupiedSchema = z
  .object({
    method: z.literal("setTaskOccupied"),
    taskId: z.string(),
    supervisorAgentId: z.string(),
  })
  .describe("Marks a task as occupied by an agent. Requires agent permissions.");

export const ReleaseTaskOccupancySchema = z
  .object({
    method: z.literal("releaseTaskOccupancy"),
    taskId: z.string(),
    supervisorAgentId: z.string(),
  })
  .describe("Releases task occupancy. Requires current agent or owner permissions.");

export const IsTaskOccupiedSchema = z
  .object({
    method: z.literal("isTaskOccupied"),
    taskId: z.string(),
    supervisorAgentId: z.string(),
  })
  .describe("Checks if a task is currently occupied. Requires current agent or owner permissions.");

export const GetTaskHistorySchema = z
  .object({
    method: z.literal("getTaskHistory"),
    taskId: z.string(),
    supervisorAgentId: z.string(),
    options: z
      .object({
        limit: z.number().optional(),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
        successOnly: z.boolean().optional(),
      })
      .optional(),
  })
  .describe("Gets execution history for a task. Requires agent permissions.");

export class TaskManagerTool extends Tool<
  JSONToolOutput<TaskManagerToolResult>,
  TaskManagerToolInput
> {
  name = "task_runner";
  description =
    "The TaskManager manages periodic task execution with ownership and permission controls. It provides functionality for scheduling, executing, and managing tasks with proper access control.";

  static {
    this.register();
  }

  private taskManager: TaskManager;

  public readonly emitter: ToolEmitter<ToolInput<this>, JSONToolOutput<TaskManagerToolResult>> =
    Emitter.root.child({
      namespace: ["tool", "task_runner"],
      creator: this,
    });

  constructor(protected readonly input: TaskManagerToolInput) {
    super(input);
    this.taskManager = input.taskManager;
  }

  inputSchema() {
    return z.discriminatedUnion("method", [
      ScheduleTaskSchema,
      StartTaskSchema,
      StopTaskSchema,
      RemoveTaskSchema,
      GetTaskStatusSchema,
      GetAllTaskStatusesSchema,
      SetTaskOccupiedSchema,
      ReleaseTaskOccupancySchema,
      IsTaskOccupiedSchema,
      GetTaskHistorySchema,
    ]);
  }

  protected async _run(input: ToolInput<this>) {
    let data: TaskManagerToolResultData;
    switch (input.method) {
      case "scheduleTask":
        data = this.taskManager.scheduleTask(input.task, input.supervisorAgentId);
        break;
      case "startTask":
        this.taskManager.startTask(input.taskId, input.supervisorAgentId);
        data = true;
        break;
      case "stopTask":
        data = this.taskManager.stopTask(input.taskId, input.supervisorAgentId);
        break;
      case "removeTask":
        data = this.taskManager.removeTask(input.taskId, input.supervisorAgentId);
        break;
      case "getTaskStatus":
        data = this.taskManager.getTaskStatus(input.taskId, input.supervisorAgentId);
        break;
      case "getAllTaskStatuses":
        data = this.taskManager.getAllTaskStatuses(input.supervisorAgentId);
        break;
      case "setTaskOccupied":
        data = this.taskManager.setTaskOccupied(input.taskId, input.supervisorAgentId);
        break;
      case "releaseTaskOccupancy":
        data = this.taskManager.releaseTaskOccupancy(input.taskId, input.supervisorAgentId);
        break;
      case "isTaskOccupied":
        data = this.taskManager.isTaskOccupied(input.taskId, input.supervisorAgentId);
        break;
      case "getTaskHistory":
        data = this.taskManager.getTaskHistory(
          input.taskId,
          input.supervisorAgentId,
          input.options,
        );
        break;
    }
    return new JSONToolOutput({
      method: input.method,
      success: true,
      data,
    } satisfies TaskManagerToolResult);
  }
}
