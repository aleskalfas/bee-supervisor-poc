import blessed from "blessed";
import chokidar from "chokidar";
import { createReadStream } from "fs";
import { join } from "path";
import { createInterface } from "readline";
import {
  AgentId,
  agentIdToString,
  AgentPoolId,
  agentPoolIdToString,
  AgentPoolTypeId,
  agentPoolTypeIdToString,
  stringAgentIdToAgentPoolTypeId,
  stringToAgentPoolId,
  stringToAgentPoolTypeId,
} from "src/agents/agent-id.js";
import {
  AgentConfig,
  AgentKind,
  AgentKindSchema,
  AvailableTool,
  PoolStats,
} from "src/agents/agent-registry.js";
import {
  AgentLifecycleData,
  AgentStateUpdate,
  AgentUpdateTypeEnum,
  AvailableToolsData,
  PoolChangeData,
} from "src/agents/agent-state-logger.js";
import { LogInit } from "src/base/audit-log.js";
import { TaskConfig, TaskHistoryEntry } from "src/tasks/task-manager.js";
import { updateDeepPartialObject } from "src/utils/objects.js";
import * as st from "./ui-config.js";

const AGENT_LIST_DEFAULT_TEXT = "Select pool to view agents";
const AGENT_TEMPLATE_DETAIL_DEFAULT_TEXT = "Select agent pool to view agent config detail";
const AGENT_DETAIL_DEFAULT_TEXT = "Select agent to view agent detail";
const AGENT_LIFECYCLE_HISTORY_DEFAULT_TEXT = "Select agent to view lifecycle events";

export interface Agent {
  agentId: AgentId;
  inUse: boolean;
  isDestroyed: boolean;
  assignedTaskConfig: TaskConfig | null;
  history: TaskHistoryEntry[];
}

export interface AgentPool {
  agentPoolTypeId: AgentPoolTypeId;
  agentConfig: AgentConfig;
  poolStats: PoolStats;
}

class AgentMonitor {
  private screen: blessed.Widgets.Screen;
  private agentPools = new Map<string, Map<string, AgentPool>>();
  private agentPoolList: blessed.Widgets.ListElement;
  private agentPoolListItemsData: {
    agentPoolId: AgentPoolId | AgentPoolTypeId;
    itemContent: string;
  }[] = [];
  private agentPoolListSelectedIndex: number | null = null;

  private agents = new Map<string, Agent>();
  private agentList: blessed.Widgets.ListElement;
  private agentListItemsData: {
    agent: Agent;
    itemContent: string;
  }[] = [];
  private agentListSelectedIndex: number | null = null;
  private agentTemplateDetail: blessed.Widgets.BoxElement;
  private agentDetail: blessed.Widgets.BoxElement;
  private lifecycleHistory: blessed.Widgets.BoxElement;
  private logBox: blessed.Widgets.Log;

  private availableTools = new Map<AgentKind, AvailableTool[]>();
  private allAvailableTools = new Map<string, AvailableTool>();
  private lifecycleEvents = new Map<
    string,
    { timestamp: string; event: string; success: boolean; error?: string }[]
  >();

  constructor() {
    this.screen = blessed.screen({
      smartCSR: true,
      title: "Agent Registry Monitor",
      debug: true,
    });

    // Left column - Pools and Agents (30%)
    this.agentPoolList = blessed.list({
      parent: this.screen,
      width: "30%",
      height: "20%",
      left: 0,
      top: 0,
      border: { type: "line" },
      label: " Agent Pools ",
      style: st.UIConfig.list,
      tags: true,
      scrollable: true,
      mouse: true,
      keys: true,
      vi: true,
      scrollbar: st.UIConfig.scrollbar,
    });

    this.agentList = blessed.list({
      parent: this.screen,
      width: "30%",
      height: "50%",
      left: 0,
      top: "20%",
      border: { type: "line" },
      label: " Agents ",
      content: AGENT_LIST_DEFAULT_TEXT,
      style: st.UIConfig.list,
      tags: true,
      scrollable: true,
      mouse: true,
      keys: true,
      vi: true,
      scrollbar: st.UIConfig.scrollbar,
    });

    // Center column - Details and Tools (40%)
    this.agentTemplateDetail = blessed.box({
      parent: this.screen,
      width: "40%",
      height: "40%",
      left: "30%",
      top: 0,
      border: { type: "line" },
      label: " Agent Config ",
      content: AGENT_TEMPLATE_DETAIL_DEFAULT_TEXT,
      tags: true,
      scrollable: true,
      mouse: true,
      keys: true,
      vi: true,
      scrollbar: st.UIConfig.scrollbar,
    });

    this.agentDetail = blessed.box({
      parent: this.screen,
      width: "40%",
      height: "30%",
      left: "30%",
      top: "40%",
      border: { type: "line" },
      label: " Agent Detail ",
      content: AGENT_DETAIL_DEFAULT_TEXT,
      tags: true,
      scrollable: true,
      mouse: true,
      keys: true,
      vi: true,
      scrollbar: st.UIConfig.scrollbar,
    });

    // Right column - Lifecycle History (30%)
    this.lifecycleHistory = blessed.box({
      parent: this.screen,
      width: "30%",
      height: "70%",
      right: 0,
      top: 0,
      border: { type: "line" },
      label: " Lifecycle Events ",
      content: AGENT_LIFECYCLE_HISTORY_DEFAULT_TEXT,
      tags: true,
      scrollable: true,
      mouse: true,
      keys: true,
      vi: true,
      scrollbar: st.UIConfig.scrollbar,
    });

    // Bottom - Live Updates
    this.logBox = blessed.log({
      parent: this.screen,
      width: "100%",
      height: "30%",
      left: 0,
      bottom: 0,
      border: { type: "line" },
      label: " Live Updates ",
      tags: true,
      scrollable: true,
      mouse: true,
      keys: true,
      vi: true,
      scrollbar: st.UIConfig.scrollbar,
    });

    this.setupEventHandlers();
    this.screen.render();
  }

  private setupEventHandlers() {
    this.screen.key(["escape", "q", "C-c"], () => process.exit(0));

    this.agentPoolList.on("select", (_, selectedIndex) => {
      this.agentPoolListSelectedIndex = selectedIndex;
      const itemData = this.agentPoolListItemsData[this.agentPoolListSelectedIndex];
      if (!itemData) {
        throw new Error(`Missing data for selectedIndex:${this.agentPoolListSelectedIndex}`);
      }
      let agentConfig;
      const agentPoolId = itemData.agentPoolId;
      if ((agentPoolId as AgentPoolTypeId).agentType) {
        agentConfig = this.agentPools
          .get(agentPoolIdToString(agentPoolId))
          ?.get(agentPoolTypeIdToString(agentPoolId as AgentPoolTypeId))?.agentConfig;
      }

      this.updateAgentConfig(agentConfig, false);
      this.updateAgentList();
    });

    this.agentList.on("select", (_, selectedIndex) => {
      this.agentListSelectedIndex = selectedIndex;
      const itemData = this.agentListItemsData[this.agentListSelectedIndex];
      if (!itemData) {
        throw new Error(`Missing data for selectedIndex:${this.agentPoolListSelectedIndex}`);
      }
      const { agent } = itemData;
      const agentConfig = this.agentPools
        .get(agentPoolIdToString(agent.agentId))
        ?.get(agentPoolTypeIdToString(agent.agentId))?.agentConfig;
      this.updateAgentConfig(agentConfig, false);
      this.updateAgentDetails(itemData.agent);
    });

    // Mouse scrolling for all components
    [
      this.agentPoolList,
      this.agentList,
      this.agentTemplateDetail,
      this.agentDetail,
      this.lifecycleHistory,
    ].forEach((component) => {
      component.on("mouse", (data) => {
        if (data.action === "wheelup") {
          component.scroll(-1);
          this.screen.render();
        } else if (data.action === "wheeldown") {
          component.scroll(1);
          this.screen.render();
        }
      });
    });
  }

  private reset(shouldRender = true): void {
    // Reset data
    [this.agents, this.agentPools, this.agents, this.availableTools].forEach((m) => {
      m.clear();
    });

    // Update content
    this.updateAgentPoolsList(false);
    this.updateAgentConfig(undefined, false);
    this.updateAgentList(false);
    this.updateAgentConfig(undefined, false);

    // Reset log box
    this.logBox.setContent("");
    this.logBox.log("Reading initial state from log...");

    // Render
    if (shouldRender) {
      this.screen.render();
    }
  }

  private updateAgentPoolsList(shouldRender = true): void {
    this.agentPoolListItemsData.splice(0);
    Array.from(this.agentPools.entries())
      .sort(([a], [b]) => {
        // Sort agent kind
        const aPoolId = stringToAgentPoolId(a);
        const bPoolId = stringToAgentPoolId(b);
        const aSuper = aPoolId.agentKind === AgentKindSchema.Values.supervisor;
        const bSuper = bPoolId.agentKind === AgentKindSchema.Values.supervisor;
        if (aSuper && !bSuper) {
          return -1;
        } else if (!aSuper && bSuper) {
          return 1;
        } else {
          return aPoolId.agentKind.localeCompare(bPoolId.agentKind);
        }
      })
      .forEach(([agentPoolIdStr, agentTypePools]) => {
        const agentPoolTypeId = stringToAgentPoolId(agentPoolIdStr);
        this.agentPoolListItemsData.push({
          agentPoolId: agentPoolTypeId,
          itemContent: st.agentPoolId(agentPoolTypeId),
        });
        Array.from(agentTypePools.entries())
          .sort(([a], [b]) => {
            // Sort agent type
            const aPoolId = stringAgentIdToAgentPoolTypeId(a);
            const bPoolId = stringAgentIdToAgentPoolTypeId(b);
            return aPoolId.agentType.localeCompare(bPoolId.agentType);
          })
          .forEach(([agentPoolTypeIdStr, agentPool]) => {
            const agentPoolTypeId = stringToAgentPoolTypeId(agentPoolTypeIdStr);
            this.agentPoolListItemsData.push({
              agentPoolId: agentPoolTypeId,
              itemContent: st.agentPool(agentPool),
            });
          });
      });

    if (this.agentPoolListSelectedIndex == null && this.agentPoolListItemsData.length) {
      this.agentPoolListSelectedIndex = 0;
      this.agentPoolList.select(this.agentPoolListSelectedIndex);
    }
    this.agentPoolList.setItems(this.agentPoolListItemsData.map((it) => it.itemContent));

    this.updateAgentList(false);
    if (shouldRender) {
      this.screen.render();
    }
  }

  private updateAgentList(shouldRender = true): void {
    this.agentListItemsData.splice(0);
    Array.from(this.agents.entries())
      .filter(([, a]) => {
        if (this.agentPoolListSelectedIndex == null) {
          return false;
        }
        const agentPoolListItem = this.agentPoolListItemsData[this.agentPoolListSelectedIndex];
        if (agentPoolListItem.agentPoolId.agentKind === a.agentId.agentKind) {
          if ((agentPoolListItem.agentPoolId as AgentPoolTypeId).agentType != null) {
            return (
              (agentPoolListItem.agentPoolId as AgentPoolTypeId).agentType === a.agentId.agentType
            );
          } else {
            return true;
          }
        }
      })
      .sort(([, a], [, b]) => {
        const comp = a.agentId.agentType.localeCompare(b.agentId.agentType);
        if (comp === 0) {
          return Math.sign(a.agentId.num - b.agentId.num);
        } else {
          return comp;
        }
      })
      .forEach(([, agent]) => {
        this.agentListItemsData.push({
          agent,
          itemContent: st.agent(agent),
        });
      });
    this.agentList.setItems(this.agentListItemsData.map((it) => it.itemContent));
    this.agentList.setContent(this.agentListItemsData.length ? "" : AGENT_LIST_DEFAULT_TEXT);
    if (shouldRender) {
      this.screen.render();
    }
  }

  private updateAgentConfig(agentConfig?: AgentConfig, shouldRender = true): void {
    if (!agentConfig) {
      this.agentTemplateDetail.setContent(AGENT_TEMPLATE_DETAIL_DEFAULT_TEXT);
      if (shouldRender) {
        this.screen.render();
      }
      return;
    }

    const details = [
      `{bold}Agent Kind:{/bold} ${st.agentKind(agentConfig.agentKind)}`,
      `{bold}Agent Type:{/bold} ${st.agentType(agentConfig.agentType)}`,
      `{bold}Max Pool Size:{/bold} ${st.num(agentConfig.maxPoolSize)}`,
      `{bold}Auto-populate pool:{/bold} ${st.bool(agentConfig.autoPopulatePool)}`,
      "",
      "{bold}Description:{/bold}",
      st.desc(agentConfig.description),
      "",
      "{bold}Instructions:{/bold}",
      st.desc(agentConfig.instructions),
      "",
      "{bold}Tools:{/bold}",
      st.tools(this.mapTools(agentConfig.tools || [])),
    ].join("\n");
    this.agentTemplateDetail.setContent(details);
    if (shouldRender) {
      this.screen.render();
    }
  }

  private mapTools(tools: string[]): AvailableTool[] {
    return tools.map(
      (t) => this.allAvailableTools.get(t) ?? { name: "Undefined", description: "Lorem ipsum...." },
    );
  }

  private updateAgentDetails(agent?: Agent, shouldRender = true): void {
    if (!agent) {
      this.agentDetail.setContent(AGENT_DETAIL_DEFAULT_TEXT);
      if (shouldRender) {
        this.screen.render();
      }
      return;
    }

    const details = [
      `${st.label("ID")}: ${st.agentId(agent.agentId)}`,
      `${st.label("In Use")}: ${st.bool(agent.inUse, "busy_idle")}`,
      `${st.label("Is destroyed")}: ${st.bool(agent.isDestroyed, "inverse_color")}`,
      ...(agent.assignedTaskConfig
        ? [
            "",
            `${st.label("Task")}: ${st.taskId(agent.assignedTaskConfig.id)}`,
            `${st.label("Description")}:`,
            `${st.desc(agent.assignedTaskConfig.description)}`,
            `${st.label("Input")}:`,
            `${st.input(agent.assignedTaskConfig.input)}`,
          ]
        : []),
    ].join("\n");
    this.agentDetail.setContent(details);
    if (shouldRender) {
      this.screen.render();
    }
  }

  private updateLifecycleHistory(agentId?: string, shouldRender = true): void {
    if (!agentId) {
      this.lifecycleHistory.setContent(AGENT_LIFECYCLE_HISTORY_DEFAULT_TEXT);
      if (shouldRender) {
        this.screen.render();
      }
      return;
    }

    const events = this.lifecycleEvents.get(agentId) || [];
    const content = events.length
      ? events
          .map(
            ({ timestamp, event, success, error }) =>
              `${st.timestamp(timestamp)} ` +
              `${st.eventType(event)} ` +
              `${st.bool(success)}` +
              (error ? `\n  ${st.error(error)}` : ""),
          )
          .join("\n")
      : "No lifecycle events recorded";

    this.lifecycleHistory.setContent(content);
    if (shouldRender) {
      this.screen.render();
    }
  }

  private processLogLine(line: string, shouldRender = true): void {
    try {
      const update: AgentStateUpdate | LogInit = JSON.parse(line);
      if (update.type === "@log_init") {
        // RESET
        this.reset(shouldRender);
        return;
      }

      let data;
      let agentIdString;
      let agent;
      let poolId: AgentPoolId;
      let poolIdStr: string;
      let poolTypeId: AgentPoolTypeId;
      let poolTypeIdStr: string;
      let pool: Map<string, AgentPool> | undefined;
      let poolType: AgentPool | undefined;
      switch (update.type) {
        case AgentUpdateTypeEnum.AGENT_CONFIG:
          data = update.data as AgentConfig;
          poolId = { agentKind: data.agentKind };
          poolIdStr = agentPoolIdToString(poolId);
          poolTypeId = {
            agentKind: data.agentKind,
            agentType: data.agentType,
          } satisfies AgentPoolTypeId;
          poolTypeIdStr = agentPoolTypeIdToString(poolTypeId);
          pool = this.agentPools.get(poolIdStr);
          if (!pool) {
            poolType = {
              agentPoolTypeId: poolTypeId,
              agentConfig: data,
              poolStats: { available: 0, created: 0, inUse: 0, poolSize: 0 },
            };
            pool = new Map([[agentPoolTypeIdToString(poolTypeId), poolType]]);
            this.agentPools.set(poolIdStr, pool);
          } else {
            poolType = pool.get(poolTypeIdStr);
            if (poolType) {
              throw new Error(`PoolType ${JSON.stringify(poolTypeId)} already exists`);
            }
            poolType = {
              agentPoolTypeId: poolTypeId,
              agentConfig: data,
              poolStats: { available: 0, created: 0, inUse: 0, poolSize: 0 },
            };
            pool.set(poolTypeIdStr, poolType);
          }

          this.updateAgentPoolsList(false);
          break;
        case AgentUpdateTypeEnum.POOL:
          data = update.data as PoolChangeData;
          poolTypeId = { agentKind: data.agentKind, agentType: data.agentType };
          poolIdStr = agentPoolIdToString(poolTypeId);
          pool = this.agentPools.get(poolIdStr);
          if (!pool) {
            throw new Error(`Missing pool for agentKind: ${data.agentKind}`);
          }
          poolTypeIdStr = agentPoolTypeIdToString(poolTypeId);
          poolType = pool.get(poolTypeIdStr);
          if (!poolType) {
            throw new Error(
              `Missing pool for agentKind: ${data.agentKind} agentType: ${data.agentType}`,
            );
          }
          updateDeepPartialObject(poolType.poolStats, data);
          this.updateAgentPoolsList(false);
          break;
        case AgentUpdateTypeEnum.AVAILABLE_TOOLS:
          data = update.data as AvailableToolsData;
          this.availableTools.set(data.agentKind, data.availableTools ?? []);
          this.allAvailableTools.clear();
          Array.from(this.availableTools.values())
            .flat()
            .forEach((t) => {
              this.allAvailableTools.set(t.name, t);
            });
          this.updateAgentPoolsList(false);
          break;
        case AgentUpdateTypeEnum.AGENT:
          data = update.data as AgentLifecycleData;
          agentIdString = agentIdToString(data.agentId);
          agent = this.agents.get(agentIdString);

          if (data.event === "onCreate") {
            if (agent) {
              throw new Error(`Agent ${agentIdString} is already exists`);
            }
            agent = {
              agentId: data.agentId,
              inUse: false,
              isDestroyed: false,
              assignedTaskConfig: null,
              history: [],
            } satisfies Agent;
            this.agents.set(agentIdToString(data.agentId), agent);
            this.updateAgentList();
          } else {
            if (!agent) {
              throw new Error(`Undefined agent ${agentIdString}`);
            }
            switch (data.event) {
              case "onDestroy":
                agent.isDestroyed = true;
                break;
              case "onAcquire":
                agent.inUse = true;
                agent.assignedTaskConfig = data.taskConfig!;
                break;
              case "onRelease":
                agent.inUse = false;
                agent.assignedTaskConfig = null;
                agent.history.push(data.historyEntry!);
                break;
            }
          }

          break;
      }

      this.logBox.log(
        `${new Date().toLocaleString()} - Event ${update.type}: update ${JSON.stringify(update.data)}`,
      );

      if (shouldRender) {
        this.screen.render();
      }
    } catch (error) {
      if (error instanceof Error) {
        this.logBox.log(`Error processing log line: ${error.message}`);
      }
    }
  }

  private async initializeStateFromLog(logPath: string): Promise<void> {
    try {
      this.logBox.log("Reading initial state from log...");

      const rl = createInterface({
        input: createReadStream(logPath, { encoding: "utf8" }),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        this.processLogLine(line);
      }

      this.logBox.log(`Initial state loaded: ${this.agents.size} agents found`);
      this.updateAgentList();
    } catch (error) {
      if (error instanceof Error) {
        this.logBox.log(`Error reading initial state: ${error.message}`);
      }
    }
  }

  private watchLogFile(logPath: string): void {
    let lastProcessedSize = 0;

    chokidar
      .watch(logPath, {
        persistent: true,
        usePolling: true,
        interval: 100,
      })
      .on("change", async (path) => {
        try {
          const rl = createInterface({
            input: createReadStream(path, { encoding: "utf8", start: lastProcessedSize }),
            crlfDelay: Infinity,
          });

          for await (const line of rl) {
            this.processLogLine(line);
            lastProcessedSize += Buffer.from(line).length + 1;
          }
        } catch (error) {
          if (error instanceof Error) {
            this.logBox.log(`Error processing log update: ${error.message}`);
          }
        }
      });
  }

  public async start(): Promise<void> {
    const logPath = join(process.cwd(), "logs", "agent_state.log");

    // First read the entire log to build initial state
    await this.initializeStateFromLog(logPath);

    // Then start watching for changes
    this.watchLogFile(logPath);
  }
}

// Start the monitor
const monitor = new AgentMonitor();
monitor.start();
