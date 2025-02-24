import {
  EntityKindId,
  EntityTypeId,
  EntityVersionId,
  EntityNumId,
  EntityVersionNumId,
  stringToEntityKind,
  stringToEntityType,
  stringToEntityVersion,
  stringToEntityVersionNum,
  entityToKindString,
  entityToTypeIdString,
  entityToVersionIdString,
  entityToVersionNumIdString,
} from "@/base/entity-id.js";
import {
  AgentConfigIdValue,
  AgentConfigVersionValue,
  AgentIdValue,
  AgentKindEnum,
  AgentKindEnumSchema,
  AgentKindValue,
  AgentNumValue,
  AgentTypeValue,
} from "./registry/dto.js";

// Agent specific interfaces with domain-specific naming
export interface AgentKindId {
  agentKind: AgentKindEnum;
}

export interface AgentTypeId extends AgentKindId {
  agentType: AgentTypeValue;
}

export interface AgentConfigId extends AgentTypeId {
  agentConfigVersion: AgentConfigVersionValue;
}

export interface AgentId extends AgentTypeId {
  agentNum: AgentNumValue;
  agentConfigVersion: AgentConfigVersionValue;
}

// Public conversion functions to generic types
export function agentKindToEntityKindId(agentKindId: AgentKindId): EntityKindId<AgentKindEnum> {
  return {
    kind: agentKindId.agentKind,
  };
}

export function agentTypeToEntityTypeId(agentTypeId: AgentTypeId): EntityTypeId<AgentKindEnum> {
  return {
    ...agentKindToEntityKindId(agentTypeId),
    type: agentTypeId.agentType,
  };
}

export function agentConfigToEntityVersionId(
  agentConfigId: AgentConfigId,
): EntityVersionId<AgentKindEnum> {
  return {
    ...agentTypeToEntityTypeId(agentConfigId),
    version: agentConfigId.agentConfigVersion,
  };
}

export function agentToEntityNumId(agentId: AgentId): EntityNumId<AgentKindEnum> {
  return {
    ...agentTypeToEntityTypeId(agentId),
    num: agentId.agentNum,
  };
}

export function agentToEntityVersionNumId(agentId: AgentId): EntityVersionNumId<AgentKindEnum> {
  return {
    ...agentToEntityNumId(agentId),
    version: agentId.agentConfigVersion,
  };
}

// Agent ID validation
function validateAgentKind(kind: string): AgentKindEnum {
  const result = AgentKindEnumSchema.safeParse(kind);
  if (!result.success) {
    throw new Error(`Invalid agent kind: ${kind}`);
  }
  return result.data;
}

// Agent conversion functions from string
export function stringToAgentKind(str: string): AgentKindId {
  const generic = stringToEntityKind(str, validateAgentKind);
  return {
    agentKind: generic.kind,
  };
}

export function stringToAgentType(str: string): AgentTypeId {
  const generic = stringToEntityType(str, validateAgentKind);
  return {
    agentKind: generic.kind,
    agentType: generic.type,
  };
}

export function stringToAgentConfig(str: string): AgentConfigId {
  const generic = stringToEntityVersion(str, validateAgentKind);
  return {
    agentKind: generic.kind,
    agentType: generic.type,
    agentConfigVersion: generic.version,
  };
}

export function stringToAgent(str: string): AgentId {
  const generic = stringToEntityVersionNum(str, validateAgentKind);
  return {
    agentKind: generic.kind,
    agentType: generic.type,
    agentNum: generic.num,
    agentConfigVersion: generic.version,
  };
}

// String conversion functions
export function agentSomeIdToKindValue(
  agentSomeId: AgentKindId | AgentTypeId | AgentConfigId | AgentId,
): AgentKindValue {
  return entityToKindString(agentKindToEntityKindId(agentSomeId));
}

export function agentSomeIdToTypeValue(
  agentSomeId: AgentTypeId | AgentConfigId | AgentId,
): AgentTypeValue {
  return entityToTypeIdString(agentTypeToEntityTypeId(agentSomeId));
}

export function agentConfigIdToValue(agentConfigId: AgentConfigId): AgentConfigIdValue {
  return entityToVersionIdString(agentConfigToEntityVersionId(agentConfigId));
}

export function agentIdToString(agentId: AgentId): AgentIdValue {
  return entityToVersionNumIdString(agentToEntityVersionNumId(agentId));
}

// Generic conversion that handles any agent ID type
export function agentSomeIdToString(
  agentSomeId: AgentKindId | AgentTypeId | AgentConfigId | AgentId,
): string {
  if ("num" in agentSomeId) {
    return agentIdToString(agentSomeId as AgentId);
  }
  if ("version" in agentSomeId) {
    return agentConfigIdToValue(agentSomeId as AgentConfigId);
  }
  if ("agentType" in agentSomeId) {
    return agentSomeIdToTypeValue(agentSomeId as AgentTypeId);
  }
  return agentSomeIdToKindValue(agentSomeId);
}
