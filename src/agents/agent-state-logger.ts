import { BaseAuditLog, LogUpdate } from "../base/audit-log.js";
import { AgentConfig, AgentKind, AvailableTool } from "./agent-registry.js";

export const DEFAULT_NAME = "agent_state";
export const DEFAULT_PATH = ["logs"] as readonly string[];

export enum AgentUpdateTypeEnum {
  AVAILABLE_TOOLS = "available_tools",
  AGENT_CONFIG = "agent_config",
  POOL = "pool",
  AGENT = "agent",
}

export interface AvailableToolsData {
  agentKind: AgentKind;
  availableTools?: AvailableTool[];
}

export interface PoolChangeData {
  agentKind: AgentKind;
  agentType: string;
  available: number;
  poolSize: number;
  inUse: number;
  created: number;
}

export interface AgentLifecycleData {
  event: "onCreate" | "onDestroy" | "onAcquire" | "onRelease";
  agentId: string;
}

export type AgentStateData = AgentConfig | AvailableToolsData | PoolChangeData | AgentLifecycleData;

export interface AgentStateUpdate extends LogUpdate<AgentUpdateTypeEnum, AgentStateData> {}

class AgentStateLogger extends BaseAuditLog<AgentUpdateTypeEnum, AgentStateData, AgentStateUpdate> {
  constructor(logPath?: string) {
    super(DEFAULT_PATH, DEFAULT_NAME, logPath);
  }

  public logAgentConfigCreate(config: AgentConfig) {
    this.logUpdate({
      type: AgentUpdateTypeEnum.AGENT_CONFIG,
      data: config,
    });
  }

  public logPoolChange(data: PoolChangeData) {
    this.logUpdate({
      type: AgentUpdateTypeEnum.POOL,
      data,
    });
  }

  //   public logStatusChange(agentId: string, status: Partial<Agent>) {
  //     this.logUpdate({
  //       timestamp: new Date().toISOString(),
  //       type: AgentUpdateTypeEnum.STATUS,
  //       agentId,
  //       data: status,
  //     });
  //   }

  //   public logAgentDestroyed(agentId: string) {
  //     this.logUpdate({
  //       timestamp: new Date().toISOString(),
  //       type: AgentUpdateTypeEnum.DESTROYED,
  //       agentId,
  //       data: undefined,
  //     });
  //   }

  public logAvailableTools(agentKind: AgentKind, availableTools: AvailableTool[]) {
    this.logUpdate({
      type: AgentUpdateTypeEnum.AVAILABLE_TOOLS,
      data: {
        agentKind,
        availableTools,
      },
    });
  }

  public logAgentLifeCycle(data: AgentLifecycleData) {
    this.logUpdate({
      type: AgentUpdateTypeEnum.AGENT,
      data,
    });
  }
}

let instance: AgentStateLogger | null = null;

export const getAgentStateLogger = () => {
  if (!instance) {
    instance = new AgentStateLogger();
  }
  return instance;
};
