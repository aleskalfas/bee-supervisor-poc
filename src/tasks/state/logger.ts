import { BaseStateLogger } from "../../base/state/base-state-logger.js";
import {
  AgentTypeRegisterEvent,
  TaskConfigCreateEvent,
  TaskConfigDestroyEvent,
  TaskConfigUpdateEvent,
  TaskEventKindEnum,
  TaskHistoryEntryCreateEvent,
  TaskPoolChangeEvent,
  TaskRunCreateEvent,
  TaskRunDestroyEvent,
  TaskRunUpdateEvent,
  TaskStateDataTypeSchema,
} from "./dto.js";

export const DEFAULT_NAME = "task_state";
export const DEFAULT_PATH = ["logs"] as readonly string[];

class TaskStateLogger extends BaseStateLogger<typeof TaskStateDataTypeSchema> {
  constructor(logPath?: string) {
    super(DEFAULT_PATH, DEFAULT_NAME, logPath);
  }

  public logAgentTypeRegister(data: Omit<AgentTypeRegisterEvent, "kind">) {
    this.logUpdate({
      data: {
        kind: TaskEventKindEnum.Values.agent_type_register,
        ...data,
      },
    });
  }

  public logTaskConfigCreate(data: Omit<TaskConfigCreateEvent, "kind">) {
    this.logUpdate({
      data: {
        kind: TaskEventKindEnum.Values.task_config_create,
        ...data,
      },
    });
  }

  public logTaskConfigUpdate(data: Omit<TaskConfigUpdateEvent, "kind">) {
    this.logUpdate({
      data: {
        kind: TaskEventKindEnum.Values.task_config_update,
        ...data,
      },
    });
  }

  public logTaskConfigDestroy(data: Omit<TaskConfigDestroyEvent, "kind">) {
    this.logUpdate({
      data: {
        kind: TaskEventKindEnum.Values.task_config_destroy,
        ...data,
      },
    });
  }

  public logTaskRunCreate(data: Omit<TaskRunCreateEvent, "kind">) {
    this.logUpdate({
      data: {
        kind: TaskEventKindEnum.Values.task_run_create,
        ...data,
      },
    });
  }

  public logTaskRunUpdate(data: Omit<TaskRunUpdateEvent, "kind">) {
    this.logUpdate({
      data: {
        kind: TaskEventKindEnum.Values.task_run_update,
        ...data,
      },
    });
  }

  public logTaskRunDestroy(data: Omit<TaskRunDestroyEvent, "kind">) {
    this.logUpdate({
      data: {
        kind: TaskEventKindEnum.Values.task_run_destroy,
        ...data,
      },
    });
  }

  public logTaskHistoryEntryCreate(data: Omit<TaskHistoryEntryCreateEvent, "kind">) {
    this.logUpdate({
      data: {
        kind: TaskEventKindEnum.Values.history_entry_create,
        ...data,
      },
    });
  }

  public logPoolChange(data: Omit<TaskPoolChangeEvent, "kind">) {
    this.logUpdate({
      data: {
        kind: TaskEventKindEnum.Values.pool_change,
        ...data,
      },
    });
  }
}

let instance: TaskStateLogger | null = null;

// Export singleton instance
export const taskStateLogger = () => {
  if (!instance) {
    instance = new TaskStateLogger();
  }
  return instance;
};
