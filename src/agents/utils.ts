export interface AgentId {
  agentKind: string;
  agentType: string;
  num: number;
}

export function agentIdToString(agentId: AgentId) {
  return `${agentId.agentKind}:${agentId.agentType}[${agentId.num}]`;
}

export function stringToAgentId(agentId: string): AgentId {
  const [kind, rest] = agentId.split(":");
  const match = rest.match(/([^[]+)(?:\[(\d+)\])?/);

  return {
    agentKind: kind,
    agentType: match?.[1] ?? "",
    num: match?.[2] ? parseInt(match[2]) : -1,
  };
}
