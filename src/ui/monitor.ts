import blessed from "blessed";
import { TaskMonitor } from "./task-monitor/monitor.js";
import { AgentMonitor } from "./agent-monitor/monitor.js";
import { BaseMonitor } from "./base/monitor.js";

export class Monitor extends BaseMonitor {
  private agentMonitor: AgentMonitor;
  private taskMonitor: TaskMonitor;

  constructor(title = "Bee Supervisor Monitor") {
    super({ title });
    this.agentMonitor = new AgentMonitor({
      screen: this.screen,
      parent: blessed.box({
        parent: this.screen,
        width: "50%",
        height: "100%",
        left: 0,
        top: 0,
        mouse: true,
        keys: true,
        vi: true,
        border: { type: "bg" },
        label: "■■■ AGENT MONITOR ■■■",
      }),
    });

    this.taskMonitor = new TaskMonitor({
      screen: this.screen,
      parent: blessed.box({
        parent: this.screen,
        width: "50%",
        height: "100%",
        left: "50%",
        top: 0,
        mouse: true,
        keys: true,
        vi: true,
        border: { type: "bg" },
        label: "■■■ TASK MONITOR ■■■",
      }),
    });
  }

  start() {
    this.agentMonitor.start();
    this.taskMonitor.start();
  }
}
