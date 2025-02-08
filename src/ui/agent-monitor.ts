import blessed from "blessed";
import chokidar from "chokidar";
import { createReadStream } from "fs";
import { join } from "path";
import { createInterface } from "readline";
import {
  Agent,
  AgentConfig,
  AgentKind,
  AvailableTool,
  PoolStats,
} from "src/agents/agent-registry.js";
import {
  AgentStateUpdate,
  AgentUpdateTypeEnum,
  AvailableToolsData,
  PoolChangeData,
} from "src/agents/agent-state-logger.js";
import { AgentId, stringToAgentId } from "src/agents/utils.js";
import {
  applyAgentIdStyle,
  applyAgentKindTypeStyle,
  applyBooleanStyle,
  applyNumberStyle,
  applyStyle,
  applyToolsStyle,
  BUSY_IDLE,
  DEFAULT_VERSION,
  UIConfig,
} from "./ui-config.js";
import { updateDeepPartialObject } from "src/utils/objects.js";
import { LogInit } from "src/base/audit-log.js";

const AGENT_LIST_DEFAULT_TEXT = "Select pool to view agents";
const AGENT_TEMPLATE_DETAIL_DEFAULT_TEXT = "Select agent pool to view agent template detail";
const AGENT_DETAIL_DEFAULT_TEXT = "Select agent to view agent detail";
const AGENT_LIFECYCLE_HISTORY_DEFAULT_TEXT = "Select agent to view lifecycle events";

class AgentMonitor {
  private screen: blessed.Widgets.Screen;
  private poolList: blessed.Widgets.ListElement;
  private poolListNameAgentIdMap = new Map<string, AgentId>();
  private agentList: blessed.Widgets.ListElement;
  private agentTemplateDetail: blessed.Widgets.BoxElement;
  private agentDetail: blessed.Widgets.BoxElement;
  private lifecycleHistory: blessed.Widgets.BoxElement;
  private logBox: blessed.Widgets.Log;

  private agents = new Map<string, Agent>();
  private agentConfigs = new Map<string, Map<string, AgentConfig>>();
  private agentPoolsStats = new Map<AgentKind, Map<string, PoolStats>>();
  private availableTools = new Map<AgentKind, AvailableTool[]>();
  private allAvailableTools = new Map<string, AvailableTool>();
  private selectedPoolIndex: number | null = null;
  private selectedAgentIndex: number | null = null;
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
    this.poolList = blessed.list({
      parent: this.screen,
      width: "30%",
      height: "20%",
      left: 0,
      top: 0,
      border: { type: "line" },
      label: " Agent Pools ",
      style: UIConfig.list,
      tags: true,
      scrollable: true,
      mouse: true,
      keys: true,
      vi: true,
      scrollbar: UIConfig.scrollbar,
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
      style: UIConfig.list,
      tags: true,
      scrollable: true,
      mouse: true,
      keys: true,
      vi: true,
      scrollbar: UIConfig.scrollbar,
    });

    // Center column - Details and Tools (40%)
    this.agentTemplateDetail = blessed.box({
      parent: this.screen,
      width: "40%",
      height: "40%",
      left: "30%",
      top: 0,
      border: { type: "line" },
      label: " Agent Template ",
      content: AGENT_TEMPLATE_DETAIL_DEFAULT_TEXT,
      tags: true,
      scrollable: true,
      mouse: true,
      keys: true,
      vi: true,
      scrollbar: UIConfig.scrollbar,
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
      scrollbar: UIConfig.scrollbar,
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
      scrollbar: UIConfig.scrollbar,
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
      scrollbar: UIConfig.scrollbar,
    });

    this.setupEventHandlers();
    this.screen.render();
  }

  private setupEventHandlers() {
    this.screen.key(["escape", "q", "C-c"], () => process.exit(0));

    this.poolList.on("select", (_, selectedIndex) => {
      const item = this.poolList.getItem(selectedIndex);
      this.selectedPoolIndex = selectedIndex;
      const agentId = this.poolListNameAgentIdMap.get(item.content);
      if (!agentId) {
        throw new Error(`Missing agentId for pool ${item.content}`);
      }
      this.updateSelectedPool(agentId);
    });

    this.agentList.on("select", (_, selectedIndex) => {
      const item = this.agentList.getItem(selectedIndex);
      this.selectedAgentIndex = selectedIndex;
      if (item?.content) {
        const agentId =
          item.content
            .toString()
            .replace(/\{[^}]+\}/g, "")
            .split(" ")
            .at(-1) ?? "";
        this.updateSelectedAgent(agentId);
      }
    });

    // Mouse scrolling for all components
    [
      this.poolList,
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
    [this.agents, this.agentConfigs, this.agentPoolsStats, this.availableTools].forEach((m) =>
      m.clear(),
    );

    this.selectedPoolIndex = null;
    this.selectedAgentIndex = null;

    // Update content
    this.updatePoolList(false);
    this.updateSelectedPool(undefined, false);

    // Reset log box
    this.logBox.setContent("");
    this.logBox.log("Reading initial state from log...");

    // Render
    if (shouldRender) {
      this.screen.render();
    }
  }

  private updatePoolList(shouldRender = true): void {
    this.poolListNameAgentIdMap.clear();
    const items = Array.from(this.agentPoolsStats.entries())
      .map(([kind, map]) =>
        Array.from(map.entries()).map(([type, stats]) => {
          const content = `${applyAgentKindTypeStyle(kind as AgentKind, type)} [${applyNumberStyle(stats.available)}/${applyNumberStyle(stats.poolSize)}]`;
          const agentId = { agentKind: kind, agentType: type } satisfies AgentId;
          this.poolListNameAgentIdMap.set(content, agentId);
          return content;
        }),
      )
      .flat();
    this.poolList.setItems(items);
    this.updateAgentList(false);
    if (shouldRender) {
      this.screen.render();
    }
  }

  private updateAgentList(shouldRender = true): void {
    const items = Array.from(this.agents.values()).map(
      (agent) =>
        `${applyAgentIdStyle(stringToAgentId(agent.agentId))} ${applyBooleanStyle(agent.inUse, agent.inUse ? DEFAULT_VERSION : BUSY_IDLE)}`,
    );
    this.agentList.setItems(items);
    if (shouldRender) {
      this.screen.render();
    }
  }

  private updateSelectedPool(agentId?: AgentId, shouldRender = true) {
    this.updateAgentConfig(agentId, false);
    if (shouldRender) {
      this.screen.render();
    }
  }

  private updateSelectedAgent(agentId?: string, shouldRender = true) {
    this.updateAgentDetails(agentId, false);
    this.updateToolsList(agentId, false);
    this.updateLifecycleHistory(agentId, false);
    if (shouldRender) {
      this.screen.render();
    }
  }

  private updateAgentConfig(agentId?: AgentId, shouldRender = true): void {
    if (!agentId) {
      this.agentTemplateDetail.setContent(AGENT_TEMPLATE_DETAIL_DEFAULT_TEXT);
      if (shouldRender) {
        this.screen.render();
      }
      return;
    }

    const config = this.agentConfigs.get(agentId.agentKind)?.get(agentId.agentType) as AgentConfig;
    if (!config) {
      this.agentTemplateDetail.setContent(AGENT_TEMPLATE_DETAIL_DEFAULT_TEXT);
      if (shouldRender) {
        this.screen.render();
      }
      return;
    }
    const details = [
      `{bold}Agent Kind:{/bold} ${applyStyle(config.kind, UIConfig.labels.agentKind)}`,
      `{bold}Agent Type:{/bold} ${applyStyle(config.type, UIConfig.labels.agentType)}`,
      `{bold}Max Pool Size:{/bold} ${applyNumberStyle(config.maxPoolSize)}`,
      `{bold}Auto-populate pool:{/bold} ${applyBooleanStyle(config.autoPopulatePool)}`,
      "",
      "{bold}Description:{/bold}",
      applyStyle(config.description, UIConfig.labels.description),
      "",
      "{bold}Instructions:{/bold}",
      applyStyle(config.instructions, UIConfig.labels.input),
      "",
      "{bold}Tools:{/bold}",
      applyToolsStyle(this.mapTools(config.tools || [])),
      //   `ID: ${applyAgentIdStyle(stringToAgentId(agent.agentId))}`,
      //   `Kind: ${applyStyle(agent.kind, UIConfig.labels.agentKind)}`,
      //   `Type: ${applyStyle(agent.type, UIConfig.labels.agentType)}`,
      //   "",
      //   `{bold}Status{/bold}`,
      //   `State: ${applyBooleanStyle(agent.inUse, agent.inUse ? DEFAULT_VERSION : BUSY_IDLE)}`,
      //   `Instance: ${agent.instance ? "Active" : "Inactive"}`,
      //   "",
      //   config
      //     ? [
      //         `{bold}Configuration{/bold}`,
      //         `Pool Size: ${applyNumberStyle(config.maxPoolSize)}`,
      //         `Auto Populate: ${applyBooleanStyle(config.autoPopulatePool)}`,
      //         "",
      //         `{bold}Description{/bold}`,
      //         applyStyle(config.description, UIConfig.labels.description),
      //       ].join("\n")
      //     : "",
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private updateAgentDetails(agentId?: string, shouldRender = true): void {
    // const agent = this.agents.get(agentId);
    // const config = this.agentConfigs.get(agentId);
    // if (!agent) {
    //   return;
    // }
    // const details = [
    //   `{bold}Identity{/bold}`,
    //   `ID: ${applyAgentIdStyle(stringToAgentId(agent.agentId))}`,
    //   `Kind: ${applyStyle(agent.kind, UIConfig.labels.agentKind)}`,
    //   `Type: ${applyStyle(agent.type, UIConfig.labels.agentType)}`,
    //   "",
    //   `{bold}Status{/bold}`,
    //   `State: ${applyBooleanStyle(agent.inUse, agent.inUse ? DEFAULT_VERSION : BUSY_IDLE)}`,
    //   `Instance: ${agent.instance ? "Active" : "Inactive"}`,
    //   "",
    //   config
    //     ? [
    //         `{bold}Configuration{/bold}`,
    //         `Pool Size: ${applyNumberStyle(config.maxPoolSize)}`,
    //         `Auto Populate: ${applyBooleanStyle(config.autoPopulatePool)}`,
    //         "",
    //         `{bold}Description{/bold}`,
    //         applyStyle(config.description, UIConfig.labels.description),
    //       ].join("\n")
    //     : "",
    // ].join("\n");
    // this.agentTemplateDetail.setContent(details);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private updateToolsList(agentId?: string, shouldRender = true): void {
    // const config = this.agentConfigs.get(agentId);
    // if (!config?.tools) {
    //   this.agentDetail.setContent("No tools configured");
    //   return;
    // }
    // const content = [
    //   "{bold}Available Tools{/bold}",
    //   ...config.tools.map((tool) => `• ${applyStyle(tool, UIConfig.labels.tool)}`),
    // ].join("\n");
    // this.agentDetail.setContent(content);
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
              `${applyStyle(timestamp, UIConfig.labels.timestamp)} ` +
              `${applyStyle(event, UIConfig.labels.eventType)} ` +
              `${applyBooleanStyle(success)}` +
              (error ? `\n  ${applyStyle(error, UIConfig.labels.error)}` : ""),
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
      let poolStats;
      switch (update.type) {
        case AgentUpdateTypeEnum.AGENT_CONFIG:
          data = update.data as AgentConfig;
          this.agentConfigs.set(data.kind, new Map([[data.type, data]]));
          this.agentPoolsStats.set(
            data.kind,
            new Map([
              [data.type, { available: 0, created: 0, inUse: 0, poolSize: data.maxPoolSize }],
            ]),
          );
          this.updatePoolList(false);
          break;
        case AgentUpdateTypeEnum.POOL:
          data = update.data as PoolChangeData;
          poolStats = this.agentPoolsStats.get(data.agentKind)?.get(data.agentType);
          if (!poolStats) {
            throw new Error(
              `Missing poolStats for agentKind: ${data.agentKind}, agentType: ${data.agentType}`,
            );
          }
          updateDeepPartialObject(poolStats, data);
          this.updatePoolList(false);
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
          this.updatePoolList(false);
          break;
        case AgentUpdateTypeEnum.AGENT:
        // case AgentUpdateTypeEnum.AGENT_CONFIG:
        //   this.agentConfigs.set((update.data as Agent), update.data as AgentConfig);
        //   break;
        // case AgentUpdateTypeEnum.STATUS:
        //   agent = this.agents.get(update.agentId!) || {
        //     agentId: update.agentId!,
        //     type: "",
        //     kind: "operator",
        //     inUse: false,
        //   };
        //   Object.assign(agent, update.data);
        //   this.agents.set(update.agentId!, agent as Agent);
        //   break;
        // case AgentUpdateTypeEnum.LIFECYCLE:
        //   break;
      }

      //   if (this.selectedAgentIndex !== null) {
      //     const selectedItem = this.agentList.getItem(this.selectedAgentIndex);
      //     if (selectedItem?.content) {
      //       const selectedAgentId = selectedItem.content.toString().replace(/\{[^}]+\}/g, "");
      //       if (selectedAgentId === update.agentId) {
      //         this.updateAgentDetails(update.agentId);
      //       }
      //     }
      //   }

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
