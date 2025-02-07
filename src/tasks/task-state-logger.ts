import { TaskConfig, TaskHistoryEntry, TaskStatus } from "src/tasks/task-manager.js";
import { BaseAuditLog } from "../base/audit-log.js";

export const DEFAULT_NAME = "task_state";
export const DEFAULT_PATH = ["logs"] as readonly string[];

export enum TaskUpdateTypeEnum {
  CONFIG = "config",
  STATUS = "status",
  HISTORY = "history",
}

export type TaskStateData = TaskConfig | Partial<TaskStatus> | TaskHistoryEntry;

class TaskStateLogger extends BaseAuditLog<TaskUpdateTypeEnum, TaskStateData> {
  constructor(logPath?: string) {
    super(DEFAULT_PATH, DEFAULT_NAME, logPath);
  }

  public logConfigCreate(taskId: string, config: TaskConfig) {
    this.logUpdate({
      timestamp: new Date().toISOString(),
      type: TaskUpdateTypeEnum.CONFIG,
      taskId,
      data: config,
    });
  }

  public logStatusChange(taskId: string, status: Partial<TaskStatus>) {
    this.logUpdate({
      timestamp: new Date().toISOString(),
      type: TaskUpdateTypeEnum.STATUS,
      taskId,
      data: status,
    });
  }

  public logHistoryEntry(taskId: string, entry: TaskHistoryEntry) {
    this.logUpdate({
      timestamp: new Date().toISOString(),
      type: TaskUpdateTypeEnum.HISTORY,
      taskId,
      data: entry,
    });
  }
}

let instance: TaskStateLogger | null = null;

// Export singleton instance
export const getTaskStateLogger = () => {
  if (!instance) {
    instance = new TaskStateLogger();
  }
  return instance;
};
