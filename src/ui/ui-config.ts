import { clone } from "remeda";
import { AgentId, AgentPoolId, AgentPoolTypeId } from "src/agents/agent-id.js";
import { AgentKind, AgentKindSchema, AvailableTool } from "src/agents/agent-registry.js";
import { TaskStatusEnum } from "src/tasks/task-manager.js";
import { Agent, AgentPool } from "./agent-monitor.js";

export interface StyleItem {
  fg?: string;
  bold?: boolean;

  italic?: boolean;
  icon?: string;
}
export type StyleItemVersioned = Record<string, StyleItem>;
export type StyleItemValue = StyleItem | StyleItemVersioned;

export type StyleCategory = Record<string, StyleItemValue>;

export const DEFAULT_VERSION = "default";
export const BUSY_IDLE = "busy_idle";
export const INVERSE_COLOR = "inverse_color";
export const AMBIENT_VERSION = "ambient";

export const UIConfig = {
  labels: {
    default: { fg: "white", bold: true },
    taskId: { fg: "#CC5500", bold: true },
    status: { fg: "white", bold: true },
    agentKind: { fg: "magenta", bold: true },
    agentType: { fg: "cyan", bold: true },
    agentId: {
      [AgentKindSchema.Values.supervisor]: { fg: "#8B4513", bold: true, icon: "⬢" },
      [AgentKindSchema.Values.operator]: { fg: "#8B4513", bold: true, icon: "⬡" },
    },
    agentPoolId: { fg: "white", italic: true },
    owner: { fg: "#8B4513", bold: true },
    description: { fg: "#7393B3", bold: false },
    input: { fg: "yellow", bold: false },
    output: {
      [DEFAULT_VERSION]: { fg: "green", bold: false },
      [AMBIENT_VERSION]: { fg: "#2E8B57", bold: false },
    },
    error: { fg: "red", bold: true },
    executionTime: { fg: "yellow" },
    timestamp: { fg: "gray" },
    tool: { fg: "cyan", icon: "⚒" },
    eventType: {
      fg: "yellow",
      bold: true,
      icon: "⚡",
    },
  } satisfies StyleCategory,

  status: {
    RUNNING: { fg: "green", icon: "▶" }, // Play triangle
    FAILED: { fg: "red", icon: "■" }, // Square
    COMPLETED: { fg: "blue", icon: "●" }, // Circle
    SCHEDULED: { fg: "yellow", icon: "◆" }, // Diamond
    WAITING: { fg: "cyan", icon: "◇" }, // Hollow diamond
    STOPPED: { fg: "grey", icon: "◼" }, // Filled square
    REMOVED: { fg: "#71797E", icon: "×" }, // Cross
  } satisfies StyleCategory,

  BUSY: {
    fg: "red",
    bg: null,
    bold: true,
    prefix: "⚡",
    suffix: "",
  },
  IDLE: {
    fg: "green",
    bg: null,
    bold: false,
    prefix: "○",
    suffix: "",
  },

  boolean: {
    TRUE: {
      [DEFAULT_VERSION]: { fg: "green", icon: "[✓]" },
      [INVERSE_COLOR]: { fg: "red", icon: "[✓]" },
      [BUSY_IDLE]: {
        fg: "red",
        bold: true,
        icon: "⚡",
      },
    },
    FALSE: {
      [DEFAULT_VERSION]: { fg: "red", icon: "[✕]" },
      [INVERSE_COLOR]: { fg: "green", icon: "[✕]" },
      [BUSY_IDLE]: {
        fg: "green",
        bold: false,
        icon: "○",
      },
    },
  } satisfies StyleCategory,

  borders: {
    type: "line",
    fg: "white",
  },

  list: {
    selected: { bg: "blue", fg: "white" },
    border: { fg: "white" },
    item: {
      hover: { bg: "blue" },
    },
  },

  scrollbar: {
    ch: " ",
    track: { bg: "gray" },
    style: { inverse: true },
  },
  number: {
    positive: { fg: "green", bold: true },
    neutral: { fg: "grey", bold: false },
    negative: { fg: "red", bold: true },
  } satisfies StyleCategory,
};

export const applyStyle = (
  text: string,
  styleItem: StyleItem | StyleItemVersioned,
  version = "default",
) => {
  let style;
  if (version && Object.keys(styleItem).includes(version)) {
    style = (styleItem as StyleItemVersioned)[version];
  } else {
    style = styleItem;
  }

  let styled = text;
  if (style.fg) {
    styled = `{${style.fg}-fg}${styled}{/${style.fg}-fg}`;
  }
  if (style.bold) {
    styled = `{bold}${styled}{/bold}`;
  }
  return styled;
};

export function applyStatusStyle(status: TaskStatusEnum, value?: string) {
  const { fg, icon } = UIConfig.status[status];
  return applyStyle(`${icon} ${value ?? status}`, { ...UIConfig.labels.status, fg });
}

export function applyNumberStyle(count: number, inverse = false) {
  let style;
  if (count === 0) {
    style = UIConfig.number.neutral;
  } else if (count > 0) {
    style = inverse ? UIConfig.number.negative : UIConfig.number.positive;
  } else {
    style = inverse ? UIConfig.number.positive : UIConfig.number.negative;
  }

  return applyStyle(String(count), style);
}

export function applyBooleanStyle(
  value: boolean,
  version?: typeof DEFAULT_VERSION | typeof BUSY_IDLE | typeof INVERSE_COLOR,
) {
  const styleVersions = value ? UIConfig.boolean.TRUE : UIConfig.boolean.FALSE;
  const style = styleVersions[version ?? DEFAULT_VERSION];
  return applyStyle(style.icon, { ...style }, version);
}

export function applyAgentPoolIdStyle(agentPoolId: AgentPoolId) {
  const style = UIConfig.labels.agentPoolId;
  return applyStyle(agentPoolId.agentKind, clone(style));
}

export function applyAgentIdStyle(agentId: AgentId | AgentPoolTypeId) {
  const style = UIConfig.labels.agentId[agentId.agentKind as AgentKind];
  const isAgentId = (agentId as AgentId).num != null;
  return applyStyle(
    `${style.icon} ${agentId.agentType}${isAgentId ? `[${(agentId as AgentId).num}]` : ""}`,
    { ...style },
  );
}

export function applyToolsStyle(tools: AvailableTool[]) {
  return tools
    .map((t) => [
      applyToolNameStyle(t.name),
      applyStyle(t.description, UIConfig.labels.description),
      "",
    ])
    .join("\n");
}

export function applyToolNameStyle(toolName: string) {
  const style = UIConfig.labels.tool;
  return applyStyle(`${style.icon} ${toolName}`, style);
}

export function bool(
  value: boolean,
  version?: typeof DEFAULT_VERSION | typeof BUSY_IDLE | typeof INVERSE_COLOR,
) {
  return applyBooleanStyle(value, version);
}

export function num(value: number, inverse = false) {
  return applyNumberStyle(value, inverse);
}

export function label(value: string) {
  return applyStyle(value, UIConfig.labels.default);
}

export function agentPoolId(value: AgentPoolId) {
  return applyAgentPoolIdStyle(value);
}
export function agentPoolTypeId(value: AgentPoolTypeId) {
  return applyAgentIdStyle(value);
}
export function agentId(value: AgentId | AgentPoolTypeId) {
  return applyAgentIdStyle(value);
}
export function agentKind(value: string) {
  return applyStyle(value, UIConfig.labels.agentKind);
}
export function agentType(value: string) {
  return applyStyle(value, UIConfig.labels.agentType);
}
export function taskId(value: string) {
  return applyStyle(value, UIConfig.labels.taskId);
}
export function desc(description: string) {
  return applyStyle(description, UIConfig.labels.description);
}
export function tools(tools: AvailableTool[]) {
  return applyToolsStyle(tools);
}

export function timestamp(timestamp: string) {
  return applyStyle(timestamp, UIConfig.labels.timestamp);
}

export function eventType(event: string) {
  return applyStyle(event, UIConfig.labels.eventType);
}
export function error(error: string) {
  return applyStyle(error, UIConfig.labels.error);
}

export function input(input: string) {
  return applyStyle(input, UIConfig.labels.input);
}
export function agentPool(agentPool: AgentPool): string {
  return `${agentId(agentPool.agentConfig)} [${num(agentPool.poolStats.available)}/${num(agentPool.poolStats.poolSize)}]`;
}
export function agent(agent: Agent) {
  return `${agentId(agent.agentId)} ${bool(agent.inUse, agent.inUse ? DEFAULT_VERSION : BUSY_IDLE)}`;
}
