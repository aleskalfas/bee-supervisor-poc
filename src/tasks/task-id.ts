import {
  EntityKindId,
  EntityNumId,
  entityToKindString,
  entityToTypeIdString,
  entityToVersionIdString,
  entityToVersionNumIdString,
  EntityTypeId,
  EntityVersionId,
  EntityVersionNumId,
  stringToEntityKind,
  stringToEntityType,
  stringToEntityVersion,
  stringToEntityVersionNum,
} from "src/base/entity-id.js";
import {
  TaskConfigIdValue,
  TaskKindEnum,
  TaskKindEnumSchema,
  TaskKindValue,
  TaskRunIdValue,
  TaskTypeValue,
} from "./manager/dto.js";

// Task specific interfaces with domain-specific naming
export interface TaskKindId {
  taskKind: TaskKindEnum;
}

export interface TaskTypeId extends TaskKindId {
  taskType: string;
}

export interface TaskConfigId extends TaskTypeId {
  taskConfigVersion: number;
}

export interface TaskRunId extends TaskConfigId {
  taskRunNum: number;
}

// Public conversion functions to generic types
export function taskKindToEntityKindId(taskKindId: TaskKindId): EntityKindId<TaskKindEnum> {
  return {
    kind: taskKindId.taskKind,
  };
}

export function taskTypeToEntityTypeId(taskTypeId: TaskTypeId): EntityTypeId<TaskKindEnum> {
  return {
    ...taskKindToEntityKindId(taskTypeId),
    type: taskTypeId.taskType,
  };
}

export function taskConfigToEntityVersionId(
  taskConfigId: TaskConfigId,
): EntityVersionId<TaskKindEnum> {
  return {
    ...taskTypeToEntityTypeId(taskConfigId),
    version: taskConfigId.taskConfigVersion,
  };
}

export function taskRunToEntityNumId(taskRunId: TaskRunId): EntityNumId<TaskKindEnum> {
  return {
    ...taskTypeToEntityTypeId(taskRunId),
    num: taskRunId.taskRunNum,
  };
}

export function taskRunToEntityVersionNumId(
  taskRunId: TaskRunId,
): EntityVersionNumId<TaskKindEnum> {
  return {
    ...taskRunToEntityNumId(taskRunId),
    version: taskRunId.taskConfigVersion,
  };
}

// Task ID validation
function validateTaskKind(kind: string): TaskKindEnum {
  const result = TaskKindEnumSchema.safeParse(kind);
  if (!result.success) {
    throw new Error(`Invalid task kind: ${kind}`);
  }
  return result.data;
}

// Task conversion functions from string
export function stringToTaskKind(str: string): TaskKindId {
  const generic = stringToEntityKind(str, validateTaskKind);
  return {
    taskKind: generic.kind,
  };
}

export function stringToTaskType(str: string): TaskTypeId {
  const generic = stringToEntityType(str, validateTaskKind);
  return {
    taskKind: generic.kind,
    taskType: generic.type,
  };
}

export function stringToTaskConfig(str: string): TaskConfigId {
  const generic = stringToEntityVersion(str, validateTaskKind);
  return {
    taskKind: generic.kind,
    taskType: generic.type,
    taskConfigVersion: generic.version,
  };
}

export function stringToTaskRun(str: string): TaskRunId {
  const generic = stringToEntityVersionNum(str, validateTaskKind);
  return {
    taskKind: generic.kind,
    taskType: generic.type,
    taskRunNum: generic.num,
    taskConfigVersion: generic.version,
  };
}

// String conversion functions
export function taskSomeIdToKindValue(
  task: TaskKindId | TaskTypeId | TaskConfigId | TaskRunId,
): TaskKindValue {
  return entityToKindString(taskKindToEntityKindId(task));
}

export function taskSomeIdToTypeValue(task: TaskTypeId | TaskConfigId | TaskRunId): TaskTypeValue {
  return entityToTypeIdString(taskTypeToEntityTypeId(task));
}

export function taskConfigIdToValue(taskConfigId: TaskConfigId): TaskConfigIdValue {
  return entityToVersionIdString(taskConfigToEntityVersionId(taskConfigId));
}

export function taskRunIdToString(taskId: TaskRunId): TaskRunIdValue {
  return entityToVersionNumIdString(taskRunToEntityVersionNumId(taskId));
}

// Generic conversion that handles any task ID type
export function taskSomeIdToString(
  taskSomeId: TaskKindId | TaskTypeId | TaskConfigId | TaskRunId,
): string {
  if ("num" in taskSomeId) {
    return taskRunIdToString(taskSomeId as TaskRunId);
  }
  if ("version" in taskSomeId) {
    return taskConfigIdToValue(taskSomeId as TaskConfigId);
  }
  if ("agentType" in taskSomeId) {
    return taskSomeIdToTypeValue(taskSomeId as TaskTypeId);
  }
  return taskSomeIdToKindValue(taskSomeId);
}
