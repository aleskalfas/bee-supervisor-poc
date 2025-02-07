import { AgentKind, AgentKindSchema } from "src/agents/agent-registry.js";
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
  } satisfies StyleCategory,

  status: {
    RUNNING: { fg: "green", icon: "▶" }, // Play triangle
    FAILED: { fg: "red", icon: "■" }, // Square
    COMPLETED: { fg: "blue", icon: "●" }, // Circle
    SCHEDULED: { fg: "yellow", icon: "◆" }, // Diamond
    WAITING: { fg: "cyan", icon: "◇" }, // Hollow diamond
    STOPPED: { fg: "grey", icon: "◼" }, // Filled square
    REMOVED: { fg: "darkgray", icon: "×" }, // Cross
  } satisfies StyleCategory,

  boolean: {
    TRUE: { fg: "green", icon: "[✓]" },
    FALSE: { fg: "red", icon: "[✕]" },
  } satisfies StyleCategory,

  borders: {
    type: "line",
    fg: "white",
  },

  scrollbar: {
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
  // = version ? Object.keys(styleItem).includes(version) ? styleItem[version] :
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

export function applyBooleanStyle(value: boolean) {
  const style = value ? UIConfig.boolean.TRUE : UIConfig.boolean.FALSE;
  return applyStyle(style.icon, { fg: style.fg });
}

export function applyAgentIdStyle(agentId: AgentId) {
  const style = UIConfig.labels.agentId[agentId.agentKind as AgentKind];
  return applyStyle(`${style.icon} ${agentId.agentType}[${agentId.num}]`, { ...style });
}
