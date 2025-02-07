import blessed from "blessed";
import chokidar from "chokidar";
import { createReadStream } from "fs";
import { join } from "path";
import { createInterface } from "readline";
import { TaskStateData, TaskUpdateTypeEnum } from "src/tasks/task-state-logger.js";
import {
  TaskConfig,
  TaskHistoryEntry,
  TaskStatus,
  TaskStatusEnum,
} from "src/tasks/task-manager.js";
import { truncateText } from "src/utils/text.js";
import { formatDuration } from "src/utils/time.js";
import {
  AMBIENT_VERSION,
  applyAgentIdStyle,
  applyBooleanStyle,
  applyNumberStyle,
  applyStatusStyle,
  applyStyle,
  UIConfig,
} from "./ui-config.js";
import { stringToAgentId } from "src/agents/utils.js";

interface TaskUpdate {
  timestamp: string;
  type: TaskUpdateTypeEnum;
  taskId: string;
  data: TaskStateData;
}

class TaskMonitor {
  private screen: blessed.Widgets.Screen;
  private taskList: blessed.Widgets.ListElement;
  private taskConfig: blessed.Widgets.BoxElement;
  private taskDetails: blessed.Widgets.BoxElement;
  private taskHistory: blessed.Widgets.BoxElement;
  private logBox: blessed.Widgets.Log;
  private tasks = new Map<string, TaskStatus>();
  private taskConfigs = new Map<string, TaskConfig>();
  private selectedTaskIndex: number | null = null;

  constructor() {
    this.screen = blessed.screen({
      smartCSR: true,
      title: "Task Registry Monitor",
      debug: true,
    });

    this.taskList = blessed.list({
      parent: this.screen,
      width: "20%",
      height: "70%",
      left: 0,
      top: 0,
      border: { type: "line" },
      label: " Tasks ",
      keys: true,
      vi: true,
      mouse: true,
      style: {
        selected: { bg: "blue", fg: "white" },
        border: { fg: "white" },
        item: {
          hover: { bg: "blue" },
        },
      },
      tags: true,
      scrollable: true,
      scrollbar: {
        ch: " ",
        track: {
          bg: "gray",
        },
        style: {
          inverse: true,
        },
      },
    });

    this.taskConfig = blessed.box({
      parent: this.screen,
      width: "20%",
      height: "70%",
      left: "20%",
      top: 0,
      border: { type: "line" },
      label: " Config ",
      content: "Select a task to view config",
      tags: true,
      scrollable: true,
      mouse: true,
      keys: true,
      vi: true,
      alwaysScroll: true,
      scrollbar: {
        ch: " ",
        track: {
          bg: "gray",
        },
        style: {
          inverse: true,
        },
      },
    });

    this.taskDetails = blessed.box({
      parent: this.screen,
      width: "60%",
      height: "40%",
      right: 0,
      top: 0,
      border: { type: "line" },
      label: " Details ",
      content: "Select a task to view details",
      tags: true,
      scrollable: true,
      mouse: true,
      keys: true,
      vi: true,
      alwaysScroll: true,
      scrollbar: {
        ch: " ",
        track: {
          bg: "gray",
        },
        style: {
          inverse: true,
        },
      },
    });

    this.taskHistory = blessed.box({
      parent: this.screen,
      width: "60%",
      height: "30%",
      right: 0,
      top: "40%",
      border: { type: "line" },
      label: " History ",
      content: "Select a task to view history",
      tags: true,
      scrollable: true,
      mouse: true,
      keys: true,
      vi: true,
      alwaysScroll: true,
      scrollbar: {
        ch: " ",
        track: {
          bg: "gray",
        },
        style: {
          inverse: true,
        },
      },
    });

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
      scrollbar: {
        ch: " ",
        track: {
          bg: "gray",
        },
        style: {
          inverse: true,
        },
      },
    });

    this.screen.key(["escape", "q", "C-c"], () => process.exit(0));

    const self = this;
    // Handle task selection
    this.taskList.on("select", (_, selectedIndex) => {
      const item = this.taskList.getItem(selectedIndex);
      self.selectedTaskIndex = selectedIndex;
      if (item?.content) {
        // Remove color tags to get clean taskId
        const taskId =
          item.content
            .toString()
            .replace(/\{[^}]+\}/g, "")
            .split(" ")
            .at(-1) ?? "";
        // this.logBox.log(`Selected task: ${taskId}`);
        this.updateTaskDetails(taskId);
        this.updateTaskConfig(taskId); // Add this line
      }
    });

    // Enable mouse scrolling
    this.taskList.on("mouse", (data) => {
      if (data.action === "wheelup") {
        this.taskList.scroll(-1);
        this.screen.render();
      } else if (data.action === "wheeldown") {
        this.taskList.scroll(1);
        this.screen.render();
      }
    });

    this.taskDetails.on("mouse", (data) => {
      if (data.action === "wheelup") {
        this.taskDetails.scroll(-1);
        this.screen.render();
      } else if (data.action === "wheeldown") {
        this.taskDetails.scroll(1);
        this.screen.render();
      }
    });

    this.screen.render();
  }

  private updateTaskList(shouldRender = true): void {
    const items = Array.from(this.tasks.values()).map(
      (task) => `${applyStatusStyle(task.status, task.id)}`,
    );

    this.taskList.setItems(items);
    if (shouldRender) {
      this.screen.render();
    }
  }

  private updateTaskDetails(taskId: string, shouldRender = true): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      // this.logBox.log(`Task not found: ${taskId}`);
      return;
    }

    const details = [
      `{bold}Status:{/bold} ${applyStatusStyle(task.status)}{/}`,
      `{bold}Is Occupied:{/bold} ${applyBooleanStyle(task.isOccupied)}`,
      task.currentAgentId
        ? `{bold}Current Agent:{/bold} ${applyAgentIdStyle(stringToAgentId(task.currentAgentId))}`
        : null,
      `{bold}Owner:{/bold} ${applyAgentIdStyle(stringToAgentId(task.ownerAgentId))}`,
      `{bold}Completed Runs:{/bold} ${applyNumberStyle(task.completedRuns)}`,
      `{bold}Error Count:{/bold} ${applyNumberStyle(task.errorCount, true)}`,
      task.lastRunAt
        ? `{bold}Last Run:{/bold} ${applyStyle(new Date(task.lastRunAt).toLocaleString(), UIConfig.labels.timestamp)}`
        : null,
      task.nextRunAt
        ? `{bold}Next Run:{/bold} ${applyStyle(new Date(task.nextRunAt).toLocaleString(), UIConfig.labels.timestamp)}`
        : null,
      "",
      task.history.at(-1)?.output
        ? `{bold}Output:{/bold}\n${applyStyle(String(task.history.at(-1)?.output), UIConfig.labels.output)}`
        : null,
      "",
      "",
      task.history.at(-1)?.error
        ? `{bold}Error:{/bold}\n${applyStyle(String(task.history.at(-1)?.error), UIConfig.labels.error)}`
        : null,
      "",
    ]
      .filter((line) => line !== null)
      .join("\n");

    this.taskDetails.setContent(details);

    const history = [
      ...task.history
        .slice(-30)
        .map(
          (entry) =>
            `${applyStyle(new Date(entry.timestamp).toLocaleString(), UIConfig.labels.timestamp)}` +
            ` ${applyStatusStyle(entry.terminalStatus)}` +
            ` ${applyAgentIdStyle(stringToAgentId(String(entry.agentId)))}` +
            ` ${applyStyle(formatDuration(entry.executionTimeMs), UIConfig.labels.executionTime)}` +
            (entry.output
              ? ` ${applyStyle(truncateText(String(entry.output), 512), UIConfig.labels.output, AMBIENT_VERSION)}`
              : "") +
            (entry.error
              ? ` ${applyStyle(truncateText(entry.error, 512), UIConfig.labels.error)}`
              : ""),
        ),
    ]
      .filter((line) => line !== null)
      .join("\n");
    this.taskHistory.setContent(history);

    // this.logBox.log(`Updated details for task: ${taskId}`);
    if (shouldRender) {
      this.screen.render();
    }
  }

  private updateTaskConfig(taskId: string, shouldRender = true): void {
    const config = this.taskConfigs.get(taskId);
    if (!config) {
      this.taskConfig.setContent("No configuration available");
      return;
    }

    const details = [
      `{bold}Task ID:{/bold} ${applyStyle(config.id, UIConfig.labels.taskId)}`,
      `{bold}Agent Kind:{/bold} ${applyStyle(config.agentKind, UIConfig.labels.agentKind)}`,
      `{bold}Agent Type:{/bold} ${applyStyle(config.agentType, UIConfig.labels.agentType)}`,
      `{bold}Owner:{/bold} ${applyAgentIdStyle(stringToAgentId(config.ownerAgentId))}`,
      "",
      "{bold}Execution Settings:{/bold}",
      `{bold}Interval:{/bold} ${applyStyle(formatDuration(config.intervalMs), UIConfig.labels.timestamp)}`,
      `{bold}Run Immediately:{/bold} ${applyBooleanStyle(config.runImmediately)}`,
      config.maxRuns
        ? `{bold}Max Runs:{/bold} ${applyStyle(String(config.maxRuns), UIConfig.labels.timestamp)}`
        : null,
      config.maxRetries
        ? `{bold}Max Retries:{/bold} ${applyStyle(String(config.maxRetries), UIConfig.labels.timestamp)}`
        : null,
      config.retryDelayMs
        ? `{bold}Retry Delay:{/bold} ${applyStyle(formatDuration(config.retryDelayMs), UIConfig.labels.timestamp)}`
        : null,
      "",
      "{bold}Description:{/bold}",
      applyStyle(config.description, UIConfig.labels.description),
      "",
      "{bold}Input:{/bold}",
      applyStyle(config.input, UIConfig.labels.input),
    ]
      .filter((line) => line !== null)
      .join("\n");

    this.taskConfig.setContent(details);
    if (shouldRender) {
      this.screen.render();
    }
  }

  private processLogLine(line: string, shouldRender = true): void {
    try {
      const update: TaskUpdate = JSON.parse(line);
      const task = this.tasks.get(update.taskId) || {
        id: update.taskId,
        status: "SCHEDULED" as TaskStatusEnum,
        isOccupied: false,
        errorCount: 0,
        currentRetryAttempt: 0,
        ownerAgentId: "",
        completedRuns: 0,
        history: [],
      };

      if (update.type === TaskUpdateTypeEnum.CONFIG) {
        this.taskConfigs.set(update.taskId, update.data as TaskConfig);
      } else if (update.type === TaskUpdateTypeEnum.STATUS) {
        Object.assign(task, update.data);
      } else if (update.type === TaskUpdateTypeEnum.HISTORY) {
        task.history.push(update.data as TaskHistoryEntry);
      }

      this.tasks.set(update.taskId, task);
      this.updateTaskList(shouldRender);

      // Update details if this task is currently selected
      const selectedIndex = this.selectedTaskIndex;
      if (typeof selectedIndex === "number") {
        const selectedItem = this.taskList.getItem(selectedIndex);
        if (selectedItem?.content) {
          const selectedTaskId = selectedItem.content.toString().replace(/\{[^}]+\}/g, "");
          if (selectedTaskId === update.taskId) {
            this.updateTaskDetails(update.taskId, shouldRender);
          }
        }
      }

      this.logBox.log(
        `${new Date().toLocaleString()} - Task ${update.taskId}: ${update.type} update ${JSON.stringify(update.data)}`,
      );
      if (shouldRender) {
        this.screen.render();
      }
    } catch (error) {
      if (error instanceof Error) {
        this.logBox.log(`Error processing log line: ${error.message}`);
      } else {
        this.logBox.log("Unknown error processing log line");
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
        this.processLogLine(line, false); // Don't render updates while initializing
      }

      this.logBox.log(`Initial state loaded: ${this.tasks.size} tasks found`);
      this.updateTaskList();
      this.screen.render();
    } catch (error) {
      if (error instanceof Error) {
        this.logBox.log(`Error reading initial state: ${error.message}`);
      } else {
        this.logBox.log("Unknown error reading initial state");
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
            this.processLogLine(line, true); // Render updates for new changes
            lastProcessedSize += Buffer.from(line).length + 1; // +1 for newline
          }
        } catch (error) {
          if (error instanceof Error) {
            this.logBox.log(`Error processing log update: ${error.message}`);
          }
        }
      });
  }

  public async start(): Promise<void> {
    const logPath = join(process.cwd(), "logs", "task_state.log");

    // First read the entire log to build initial state
    await this.initializeStateFromLog(logPath);

    // Then start watching for changes
    this.watchLogFile(logPath);
  }
}

// Start the monitor
const monitor = new TaskMonitor();
monitor.start();
