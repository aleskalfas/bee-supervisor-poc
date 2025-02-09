import { AgentKind } from "./agent-registry.js";

export interface AgentId extends AgentPoolTypeId {
  num: number;
}

export interface AgentPoolTypeId extends AgentPoolId {
  agentType: string;
}

export interface AgentPoolId {
  agentKind: AgentKind;
}

export function agentPoolIdToString(agentPoolId: AgentPoolId) {
  return `${agentPoolId.agentKind}`;
}

export function agentPoolTypeIdToString(agentPoolId: AgentPoolTypeId) {
  return `${agentPoolIdToString(agentPoolId)}:${agentPoolId.agentType}`;
}

export function stringToAgentPoolId(agentPoolId: string): AgentPoolId {
  return {
    agentKind: agentPoolId as AgentKind,
  };
}

export function stringToAgentPoolTypeId(agentPoolTypeId: string): AgentPoolTypeId {
  const [kind, rest] = agentPoolTypeId.split(":");

  return {
    agentKind: kind as AgentKind,
    agentType: rest,
  };
}

export function stringAgentIdToAgentPoolTypeId(agentPoolId: string): AgentPoolTypeId {
  const [kind, rest] = agentPoolId.split(":");
  const [type] = rest.split("[");

  return {
    agentKind: kind as AgentKind,
    agentType: type,
  };
}

export function agentIdToString(agentId: AgentId) {
  return `${agentPoolTypeIdToString(agentId)}[${agentId.num}]`;
}

export function stringToAgentId(agentId: string): AgentId {
  const agentPoolId = stringAgentIdToAgentPoolTypeId(agentId);
  const num = parseInt((agentId.match(/\[(.*?)\]/) || [])[1]);

  if (num == null) {
    throw new Error(`AgentId ${agentId} valid num is not presence`);
  }

  return {
    ...agentPoolId,
    num,
  };
}
