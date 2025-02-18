import blessed from "blessed";
import { TaskMonitor } from "./task-monitor/monitor.js";
import { AgentMonitor } from "./agent-monitor/monitor.js";

const screen = blessed.screen({
  smartCSR: true,
  title: "Supervisor UI",
  debug: true,
});

new AgentMonitor({
  screen,
  parent: blessed.box({
    parent: screen,
    width: "50%",
    height: "100%",
    left: 0,
    top: 0,
    mouse: true,
    keys: true,
    vi: true,
    border: { type: "line" },
    label: " Agent Monitor ",
  }),
}).start();

new TaskMonitor({
  screen,
  parent: blessed.box({
    parent: screen,
    width: "50%",
    height: "100%",
    left: "50%",
    top: 0,
    mouse: true,
    keys: true,
    vi: true,
    border: { type: "line" },
    label: " Task Monitor ",
  }),
}).start();
