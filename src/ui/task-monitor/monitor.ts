import blessed from "blessed";
import { join } from "path";
import { clone } from "remeda";
import { stringToAgent } from "src/agents/agent-id.js";
import { isTaskRunActiveStatus, TaskConfig, TaskKindEnumSchema } from "src/tasks/manager/dto.js";
import { StateUpdateType, TaskRunInfo, TaskStateBuilder } from "src/tasks/state/builder.js";
import {
  stringToTaskConfig,
  stringToTaskKind,
  stringToTaskRun,
  TaskConfigId,
  TaskKindId,
  taskSomeIdToTypeValue,
  TaskTypeId,
} from "src/tasks/task-id.js";
import { BaseMonitor, ParentInput, ScreenInput } from "../base/monitor.js";
import * as st from "../config.js";

const TASK_CONFIG_DETAIL_DEFAULT_TEXT = "Select task pool to view task config detail";
const TASK_VERSION_DEFAULT_TEXT = "Select pool to view versions";
const TASK_RUN_LIST_DEFAULT_TEXT = "Select pool to view tasks";
const TASK_RUN_DETAIL_DEFAULT_TEXT = "Select task run to view task run detail";
// const TASK_LIFECYCLE_HISTORY_DEFAULT_TEXT = "Select task run to view lifecycle events";

export class TaskMonitor extends BaseMonitor {
  private stateBuilder: TaskStateBuilder;
  private taskPoolList: blessed.Widgets.ListElement;
  private taskPoolListItemsData: {
    taskTypeId: TaskTypeId | TaskKindId;
    itemContent: string;
  }[] = [];
  private taskPoolListSelectedIndex: number | null = null;

  private taskVersionsList: blessed.Widgets.ListElement;
  private taskVersionsListItemsData: {
    taskTypeId: TaskConfigId;
    itemContent: string;
  }[] = [];
  private taskVersionsListSelectedIndex: number | null = null;

  private taskRunList: blessed.Widgets.ListElement;
  private taskRunListItemsData: {
    taskRun: TaskRunInfo;
    itemContent: string;
  }[] = [];
  private taskRunListSelectedIndex: number | null = null;

  private taskConfigDetail: blessed.Widgets.BoxElement;
  private taskRunDetail: blessed.Widgets.BoxElement;
  private logBox: blessed.Widgets.Log;

  constructor(arg: ParentInput | ScreenInput) {
    super(arg);
    this.stateBuilder = new TaskStateBuilder();
    this.stateBuilder.on("log:reset", () => {
      this.reset();
    });
    this.stateBuilder.on("log:new_line", (line) => {
      this.logBox.log(`${new Date().toLocaleString()} - ${line}`);
    });
    this.stateBuilder.on("state:updated", (update) => {
      switch (update.type) {
        case StateUpdateType.TASK_CONFIG:
        case StateUpdateType.POOL:
          this.updateTaskPoolsList(false);
          break;
        case StateUpdateType.TASK_RUN:
          this.updateTaskVersionsList(false);
          break;
        case StateUpdateType.HISTORY_ENTRY:
          this.updateTaskRunDetails(undefined, false);
          break;
        //   case StateUpdateType.AGENT:
        //     this.updateAgentVersionsList(false);
        //     this.updateAgentDetails();
        //     break;
        //   case StateUpdateType.ASSIGNMENT:
        //     this.updateAgentDetails();
        //     break;
        //   case StateUpdateType.FULL:
        //     // Full refresh
        //     // this.reset();
        //     break;
      }
    });

    this.stateBuilder.on("error", (error: Error) => {
      this.logBox.log(`Error occurred: ${JSON.stringify(error)}`);
    });

    // Left column - Pools and Task Runs (70%)
    this.taskPoolList = blessed.list({
      parent: this.parent,
      width: "30%",
      height: "20%",
      left: 0,
      top: 0,
      border: { type: "line" },
      label: " Task Pools ",
      style: st.UIConfig.list,
      tags: true,
      scrollable: true,
      mouse: true,
      keys: true,
      vi: true,
      scrollbar: st.UIConfig.scrollbar,
    });

    this.taskVersionsList = blessed.list({
      parent: this.parent,
      width: "30%",
      height: "20%",
      left: 0,
      top: "20%",
      border: { type: "line" },
      label: " Task Runs Versions ",
      content: TASK_VERSION_DEFAULT_TEXT,
      style: st.UIConfig.list,
      tags: true,
      scrollable: true,
      mouse: true,
      keys: true,
      vi: true,
      scrollbar: st.UIConfig.scrollbar,
    });

    this.taskRunList = blessed.list({
      parent: this.parent,
      width: "30%",
      height: "30%",
      left: 0,
      top: "40%",
      border: { type: "line" },
      label: " Task Runs ",
      content: TASK_RUN_LIST_DEFAULT_TEXT,
      style: st.UIConfig.list,
      tags: true,
      scrollable: true,
      mouse: true,
      keys: true,
      vi: true,
      scrollbar: st.UIConfig.scrollbar,
    });

    // Center column - Details and Tools (40%)
    this.taskConfigDetail = blessed.box({
      parent: this.parent,
      width: "40%",
      height: "20%",
      left: "30%",
      top: 0,
      border: { type: "line" },
      label: " Task Config ",
      content: TASK_CONFIG_DETAIL_DEFAULT_TEXT,
      tags: true,
      scrollable: true,
      mouse: true,
      keys: true,
      vi: true,
      scrollbar: st.UIConfig.scrollbar,
    });

    this.taskRunDetail = blessed.box({
      parent: this.parent,
      width: "40%",
      height: "50%",
      left: "30%",
      top: "20%",
      border: { type: "line" },
      label: " Task Run Detail ",
      content: TASK_RUN_DETAIL_DEFAULT_TEXT,
      tags: true,
      scrollable: true,
      mouse: true,
      keys: true,
      vi: true,
      scrollbar: st.UIConfig.scrollbar,
    });

    // Bottom - Live Updates
    this.logBox = blessed.log({
      parent: this.parent,
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

    this.taskPoolList.on("select", (_, selectedIndex) => {
      this.taskPoolListSelectedIndex = selectedIndex;
      const itemData = this.taskPoolListItemsData[this.taskPoolListSelectedIndex];
      if (!itemData) {
        throw new Error(
          `Missing data for selected pool on index:${this.taskPoolListSelectedIndex}`,
        );
      }
      let taskConfig;
      const taskTypeId = itemData.taskTypeId;
      if ((taskTypeId as TaskTypeId).taskType) {
        taskConfig = this.stateBuilder.getTaskConfig(
          taskSomeIdToTypeValue(taskTypeId as TaskTypeId),
        );
      }

      this.updateTaskConfig(taskConfig, false);
      this.updateTaskVersionsList();
    });

    this.taskVersionsList.on("select", (_, selectedIndex) => {
      this.taskVersionsListSelectedIndex = selectedIndex;
      const itemData = this.taskVersionsListItemsData[this.taskVersionsListSelectedIndex];
      if (!itemData) {
        throw new Error(`Missing data for selectedIndex:${this.taskVersionsListSelectedIndex}`);
      }

      const taskConfigId = itemData.taskTypeId as TaskConfig;
      const taskConfig = this.stateBuilder.getTaskConfig(
        taskSomeIdToTypeValue(taskConfigId),
        taskConfigId.taskConfigVersion,
      );

      this.updateTaskConfig(taskConfig, false);
      this.updateTaskVersionsList();
    });

    this.taskRunList.on("select", (_, selectedIndex) => {
      this.taskRunListSelectedIndex = selectedIndex;
      const itemData = this.taskRunListItemsData[this.taskRunListSelectedIndex];
      if (!itemData) {
        throw new Error(`Missing data for selectedIndex:${this.taskPoolListSelectedIndex}`);
      }
      const { taskRun } = itemData;
      const taskRunConfigId = stringToTaskConfig(taskRun.taskConfigId);
      const taskRunTypeId = taskSomeIdToTypeValue(taskRunConfigId);
      const taskRunConfig = this.stateBuilder.getTaskConfig(
        taskRunTypeId,
        taskRunConfigId.taskConfigVersion,
      );
      this.updateTaskConfig(taskRunConfig, false);
      this.updateTaskRunDetails(itemData.taskRun);
    });

    // Mouse scrolling for all components
    [
      this.taskPoolList,
      this.taskRunList,
      this.taskConfigDetail,
      this.taskRunDetail,
      // this.lifecycleHistory,
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

  updateTaskPoolsList(shouldRender = true): void {
    this.taskPoolListItemsData.splice(0);
    const state = this.stateBuilder.getState();
    Array.from(state.taskRunPools.entries())
      .sort(([a], [b]) => {
        // Sort task kind
        const aPoolId = stringToTaskKind(a);
        const bPoolId = stringToTaskKind(b);
        const aSuper = aPoolId.taskKind === TaskKindEnumSchema.Values.supervisor;
        const bSuper = bPoolId.taskKind === TaskKindEnumSchema.Values.supervisor;
        if (aSuper && !bSuper) {
          return -1;
        } else if (!aSuper && bSuper) {
          return 1;
        } else {
          return aPoolId.taskKind.localeCompare(bPoolId.taskKind);
        }
      })
      .forEach(([taskKindStr, taskTypePools]) => {
        const taskKindId = stringToTaskKind(taskKindStr);
        this.taskPoolListItemsData.push({
          taskTypeId: taskKindId,
          itemContent: st.taskKindId(taskKindId),
        });
        Array.from(taskTypePools.entries())
          .sort(([a], [b]) => {
            // Sort task type
            return a.localeCompare(b);
          })
          .forEach(([taskTypeStr, taskPool]) => {
            this.taskPoolListItemsData.push({
              taskTypeId: { taskKind: taskKindId.taskKind, taskType: taskTypeStr },
              itemContent: st.taskPool(taskPool),
            });
          });
      });

    if (this.taskPoolListSelectedIndex == null && this.taskPoolListItemsData.length) {
      this.taskPoolListSelectedIndex = 0;
      this.taskPoolList.select(this.taskPoolListSelectedIndex);
    }
    this.taskPoolList.setItems(this.taskPoolListItemsData.map((it) => it.itemContent));

    this.updateTaskVersionsList(false);
    if (shouldRender) {
      this.screen.render();
    }
  }

  private updateTaskVersionsList(shouldRender = true): void {
    this.taskVersionsListItemsData.splice(0);

    if (this.taskPoolListSelectedIndex != null) {
      // Get versions of selected task pool
      const itemData = this.taskPoolListItemsData[this.taskPoolListSelectedIndex];
      if (!itemData) {
        throw new Error(
          `Missing data for selected pool on index:${this.taskPoolListSelectedIndex}`,
        );
      }

      const taskPoolTypeId = itemData.taskTypeId as TaskTypeId;
      if (taskPoolTypeId.taskType != null) {
        // List versions
        const taskPool = this.stateBuilder.getTaskPool(
          taskPoolTypeId.taskKind,
          taskPoolTypeId.taskType,
        );
        if (taskPool) {
          const hasMultipleVersions = taskPool.versions.length > 1;
          if (hasMultipleVersions) {
            this.taskPoolListItemsData.push({
              taskTypeId: {
                taskKind: taskPoolTypeId.taskKind,
                taskType: taskPoolTypeId.taskType,
              },
              itemContent: st.versionAgentPoolStats("all"),
            });
          }

          clone(taskPool.versions)
            .reverse()
            .forEach(([taskConfigVersion, poolStats]) => {
              const taskTypeId = {
                taskKind: taskPoolTypeId.taskKind,
                taskType: taskPoolTypeId.taskType,
                taskConfigVersion,
              };
              this.taskVersionsListItemsData.push({
                taskTypeId,
                itemContent: st.versionTaskPoolStats(st.versionNum(taskConfigVersion), poolStats),
              });
            });
        }
      }
    }

    this.taskVersionsList.setItems(this.taskVersionsListItemsData.map((it) => it.itemContent));
    this.taskVersionsList.setContent(
      this.taskVersionsListItemsData.length ? "" : TASK_VERSION_DEFAULT_TEXT,
    );
    this.updateTaskList(false);
    if (shouldRender) {
      this.screen.render();
    }
  }

  private updateTaskList(shouldRender = true): void {
    this.taskRunListItemsData.splice(0);
    if (this.taskVersionsListSelectedIndex != null) {
      Array.from(this.stateBuilder.getAllTaskRuns())
        .filter((a) => {
          if (this.taskVersionsListSelectedIndex == null) {
            return false;
          }

          const taskRunId = stringToTaskRun(a.taskRunId);
          const taskRunPoolListItem =
            this.taskVersionsListItemsData[this.taskVersionsListSelectedIndex];
          if (
            taskRunPoolListItem &&
            taskRunPoolListItem.taskTypeId.taskKind === taskRunId.taskKind
          ) {
            if ((taskRunPoolListItem.taskTypeId as TaskTypeId).taskType != null) {
              if ((taskRunPoolListItem.taskTypeId as TaskTypeId).taskType == taskRunId.taskType) {
                if ((taskRunPoolListItem.taskTypeId as TaskConfigId).taskConfigVersion != null) {
                  return (
                    (taskRunPoolListItem.taskTypeId as TaskConfigId).taskConfigVersion ===
                    taskRunId.taskConfigVersion
                  );
                }
              } else {
                return false;
              }
            }
            return true;
          }
          return false;
        })
        .sort((a, b) => {
          const aTaskRunId = stringToTaskRun(a.taskRunId);
          const bTaskRunId = stringToTaskRun(b.taskRunId);

          if (aTaskRunId.taskConfigVersion != bTaskRunId.taskConfigVersion) {
            return Math.sign(aTaskRunId.taskConfigVersion - bTaskRunId.taskConfigVersion);
          }

          const comp = aTaskRunId.taskType.localeCompare(bTaskRunId.taskType);
          if (comp === 0) {
            return Math.sign(aTaskRunId.taskRunNum - bTaskRunId.taskRunNum);
          } else {
            return comp;
          }
        })
        .forEach((task) => {
          this.taskRunListItemsData.push({
            taskRun: task,
            itemContent: st.task(task),
          });
        });
    }

    this.taskRunList.setItems(this.taskRunListItemsData.map((it) => it.itemContent));
    this.taskRunList.setContent(this.taskRunListItemsData.length ? "" : TASK_RUN_LIST_DEFAULT_TEXT);
    if (shouldRender) {
      this.screen.render();
    }
  }

  private updateTaskConfig(taskConfig?: TaskConfig, shouldRender = true): void {
    if (!taskConfig) {
      this.taskConfigDetail.setContent(TASK_CONFIG_DETAIL_DEFAULT_TEXT);
      if (shouldRender) {
        this.screen.render();
      }
      return;
    }

    const details = [
      `${st.label("Id")}:  ${st.taskConfigId(taskConfig.taskConfigId)}`,
      `${st.label("Version")}:  ${st.versionNum(taskConfig.taskConfigVersion)}`,
      `${st.label("Task Kind")}:  ${st.taskKind(taskConfig.taskKind)}`,
      `${st.label("Task Type")}:  ${st.taskType(taskConfig.taskType)}`,
      `${st.label("Max Repeats")}:  ${st.num(taskConfig.maxRepeats || 0)}`,
      `${st.label("Interval ms")}:  ${st.num(taskConfig.intervalMs)}`,
      `${st.label("Concurrency Mode")}:  ${st.concurrencyMode(taskConfig.concurrencyMode)}`,
      "",
      `${st.label("Description")}: `,
      st.desc(taskConfig.description),
      "",
      `${st.label("Input")}: `,
      st.input(taskConfig.taskConfigInput, "ambient"),
    ].join("\n");
    this.taskConfigDetail.setContent(details);
    if (shouldRender) {
      this.screen.render();
    }
  }

  private updateTaskRunDetails(taskRunInfo?: TaskRunInfo, shouldRender = true): void {
    if (!taskRunInfo) {
      this.taskRunDetail.setContent(TASK_RUN_DETAIL_DEFAULT_TEXT);
      if (shouldRender) {
        this.screen.render();
      }
      return;
    }

    const {
      taskRunId,
      status,
      isOccupied,
      currentAgentId,
      ownerAgentId,
      completedRuns,
      errorCount,
      lastRunAt,
      nextRunAt,
      history,
      taskRunInput,
    } = taskRunInfo.taskRun;

    const { isDestroyed } = taskRunInfo;

    const details = [
      `${st.label("Id")}: ${st.taskRunId(stringToTaskRun(taskRunId))}`,
      `${st.label("In Use")}: ${st.bool(isTaskRunActiveStatus(status), "busy_idle")}`,
      `${st.label("Status")}: ${st.taskRunStatus(status)}`,
      `${st.label("Is Destroyed")}: ${st.bool(isDestroyed, "inverse_color")}`,
      `${st.label("Is Occupied")}:  ${st.bool(isOccupied)}${currentAgentId ? st.agentId(stringToAgent(currentAgentId)) : ""}`,
      `${st.label("Owner")}:  ${st.agentId(stringToAgent(ownerAgentId))}`,
      `${st.label("Completed Runs")}:  ${st.num(completedRuns)}`,
      `${st.label("Error Count")}:  ${st.num(errorCount, true)}`,
      lastRunAt ? `${st.label("Last Run")}:  ${st.timestamp(lastRunAt)}` : null,
      nextRunAt ? `${st.label("Next Run")}:  ${st.timestamp(nextRunAt)}` : null,
      "",
      `${st.label("Input")}:`,
      `${st.input(taskRunInput)}`,
      "",
      history.at(-1)?.output
        ? `${st.label("Output")}: \n${st.output(String(history.at(-1)?.output))}`
        : null,
      "",
      "",
      history.at(-1)?.error
        ? `${st.label("Error")}: \n${st.error(String(history.at(-1)?.error))}`
        : null,
      "",
    ].join("\n");
    this.taskRunDetail.setContent(details);
    if (shouldRender) {
      this.screen.render();
    }
  }

  reset(shouldRender = true): void {
    // Reset selections
    this.taskPoolListSelectedIndex = null;

    // Update content
    this.updateTaskPoolsList(false);

    // Reset log box
    this.logBox.setContent("");
    this.logBox.log("Reading initial state from log...");

    // Render
    if (shouldRender) {
      this.screen.render();
    }
  }

  public async start(): Promise<void> {
    const logPath = join(process.cwd(), "logs", "task_state.log");
    // First read the entire log to build initial state
    await this.stateBuilder.watchLogFile(logPath);
  }
}
