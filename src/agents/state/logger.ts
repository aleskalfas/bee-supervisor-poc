import { BaseStateLogger } from "../../base/state/base-state-logger.js";
import {
  AgentAcquireEvent,
  AgentConfigCreateEvent,
  AgentConfigDestroyEvent,
  AgentConfigUpdateEvent,
  AgentCreateEvent,
  AgentDestroyEvent,
  AgentEventKindEnum,
  AgentPoolChangeEvent,
  AgentReleaseEvent,
  AgentStateDataTypeSchema,
  AssignmentKindEnum,
  AvailableToolsEvent,
  TaskAssignedEvent,
  TaskHistoryEntryEvent,
  TaskUnassignedEvent,
} from "./dto.js";

export const DEFAULT_NAME = "agent_state";
export const DEFAULT_PATH = ["logs"] as readonly string[];

class AgentStateLogger extends BaseStateLogger<typeof AgentStateDataTypeSchema> {
  constructor(logPath?: string) {
    super(DEFAULT_PATH, DEFAULT_NAME, logPath);
  }

  public logAvailableTools(data: Omit<AvailableToolsEvent, "kind">) {
    this.logUpdate({
      data: {
        kind: AgentEventKindEnum.enum.available_tools_register,
        ...data,
      },
    });
  }

  public logAgentConfigCreate(data: Omit<AgentConfigCreateEvent, "kind">) {
    this.logUpdate({
      data: {
        kind: AgentEventKindEnum.Values.agent_config_create,
        ...data,
      },
    });
  }

  public logAgentConfigUpdate(data: Omit<AgentConfigUpdateEvent, "kind">) {
    this.logUpdate({
      data: {
        kind: AgentEventKindEnum.Values.agent_config_update,
        ...data,
      },
    });
  }

  public logAgentConfigDestroy(data: Omit<AgentConfigDestroyEvent, "kind">) {
    this.logUpdate({
      data: {
        kind: AgentEventKindEnum.Values.agent_config_destroy,
        ...data,
      },
    });
  }

  public logAgentCreate(data: Omit<AgentCreateEvent, "kind">) {
    this.logUpdate({
      data: {
        kind: AgentEventKindEnum.enum.agent_create,
        ...data,
      },
    });
  }

  public logAgentAcquire(data: Omit<AgentAcquireEvent, "kind">) {
    this.logUpdate({
      data: {
        kind: AgentEventKindEnum.enum.agent_acquire,
        ...data,
      },
    });
  }

  public logAgentRelease(data: Omit<AgentReleaseEvent, "kind">) {
    this.logUpdate({
      data: {
        kind: AgentEventKindEnum.enum.agent_release,
        ...data,
      },
    });
  }

  public logAgentDestroy(data: Omit<AgentDestroyEvent, "kind">) {
    this.logUpdate({
      data: {
        kind: AgentEventKindEnum.enum.agent_destroy,
        ...data,
      },
    });
  }

  public logPoolChange(data: Omit<AgentPoolChangeEvent, "kind">) {
    this.logUpdate({
      data: {
        kind: AgentEventKindEnum.Values.pool_change,
        ...data,
      },
    });
  }

  public logTaskAssigned(data: Omit<TaskAssignedEvent, "kind" | "assignmentKind">) {
    this.logUpdate({
      data: {
        kind: AgentEventKindEnum.Values.assignment_assign,
        assignmentKind: AssignmentKindEnum.enum.task,
        ...data,
      },
    });
  }

  public logTaskUnassigned(data: Omit<TaskUnassignedEvent, "kind" | "assignmentKind">) {
    this.logUpdate({
      data: {
        kind: AgentEventKindEnum.enum.assignment_unassign,
        assignmentKind: AssignmentKindEnum.enum.task,
        ...data,
      },
    });
  }

  public logTaskHistoryEntry(data: Omit<TaskHistoryEntryEvent, "kind" | "assignmentKind">) {
    this.logUpdate({
      data: {
        kind: AgentEventKindEnum.enum.assignment_history_entry,
        assignmentKind: AssignmentKindEnum.Values.task,
        ...data,
      },
    });
  }
}

let instance: AgentStateLogger | null = null;

export const agentStateLogger = () => {
  if (!instance) {
    instance = new AgentStateLogger();
  }
  return instance;
};
