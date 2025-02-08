import { AgentKind } from "./agent-registry.js";

export const UNDEFINED_NUM = -1;

export interface AgentId {
  agentKind: AgentKind;
  agentType: string;
  num?: number;
}

export function agentIdToString(agentId: AgentId) {
  return `${agentId.agentKind}:${agentId.agentType}[${agentId.num ?? UNDEFINED_NUM}]`;
}

export function stringToAgentId(agentId: string): AgentId {
  const [kind, rest] = agentId.split(":");
  const match = rest.match(/([^[]+)(?:\[(\d+)\])?/);

  return {
    agentKind: kind as AgentKind,
    agentType: match?.[1] ?? "",
    num: match?.[2] ? parseInt(match[2]) : -1,
  };
}
