import { AgentKind, AgentKindSchema, AvailableTool } from "src/agents/agent-registry.js";
import { AgentId } from "src/agents/utils.js";
import { TaskStatusEnum } from "src/tasks/task-manager.js";

export interface StyleItem {
  fg?: string;
  bold?: boolean;
  icon?: string;
}
export type StyleItemVersioned = Record<string, StyleItem>;
export type StyleItemValue = StyleItem | StyleItemVersioned;

export type StyleCategory = Record<string, StyleItemValue>;

export const DEFAULT_VERSION = "default";
export const BUSY_IDLE = "busy_idle";
export const AMBIENT_VERSION = "ambient";

export const UIConfig = {
  labels: {
    taskId: { fg: "#CC5500", bold: true },
    status: { fg: "white", bold: true },
    agentKind: { fg: "magenta", bold: true },
    agentType: { fg: "cyan", bold: true },
    agentId: {
      [AgentKindSchema.Values.supervisor]: { fg: "#8B4513", bold: true, icon: "⬢" },
      [AgentKindSchema.Values.operator]: { fg: "#8B4513", bold: true, icon: "⬡" },
    },
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
      [BUSY_IDLE]: {
        fg: "red",
        bold: true,
        icon: "⚡",
      },
    },
    FALSE: {
      [DEFAULT_VERSION]: { fg: "red", icon: "[✕]" },
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
  version?: typeof DEFAULT_VERSION | typeof BUSY_IDLE,
) {
  const styleVersions = value ? UIConfig.boolean.TRUE : UIConfig.boolean.FALSE;
  const style = styleVersions[version ?? DEFAULT_VERSION];
  return applyStyle(style.icon, { ...style }, version);
}

export function applyAgentIdStyle(agentId: AgentId) {
  const style = UIConfig.labels.agentId[agentId.agentKind as AgentKind];
  return applyStyle(`${style.icon} ${agentId.agentType}[${agentId.num}]`, { ...style });
}

export function applyAgentKindTypeStyle(agentKind: AgentKind, agentType: string) {
  const style = UIConfig.labels.agentId[agentKind as AgentKind];
  return applyStyle(`${style.icon} ${agentType}`, { ...style });
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
