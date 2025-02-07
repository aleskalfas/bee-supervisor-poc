import { pino } from "pino";
import fs from "fs";
import { AgentKind } from "src/agents/agent-registry.js";

// Ensure logs directory exists
if (!fs.existsSync("logs")) {
  fs.mkdirSync("logs");
}

// Create separate log files for different components
const supervisorLogger = pino(
  {
    level: process.env.LOGGER_LEVEL || "info",
  },
  pino.destination("logs/supervisor_agents.log"),
);

const registryLogger = pino(
  {
    level: process.env.LOGGER_LEVEL || "info",
  },
  pino.destination("logs/agent_registry.log"),
);

const taskManagerLogger = pino(
  {
    level: process.env.LOGGER_LEVEL || "info",
  },
  pino.destination("logs/task_manager.log"),
);

// Cache for operator loggers
const operatorLoggers = new Map();

export enum LoggerType {
  AGENT = "agent",
  REGISTRY = "registry",
  TASK_MANAGER = "taskManager",
}

export function getLogger(type: LoggerType, agentKind: AgentKind | null = null, operatorId = null) {
  switch (type) {
    case "registry":
      return registryLogger;
    case "taskManager":
      return taskManagerLogger;
    case "agent":
      switch (agentKind) {
        case "supervisor":
          return supervisorLogger;
        case "operator":
          // If operatorId is provided, create/get specific operator logger
          if (operatorId !== null) {
            if (!operatorLoggers.has(operatorId)) {
              operatorLoggers.set(
                operatorId,
                pino(
                  { level: process.env.LOGGER_LEVEL || "info" },
                  pino.destination(`logs/operator_${operatorId}_agents.log`),
                ),
              );
            }
            return operatorLoggers.get(operatorId);
          }
          // Default operator logger for backward compatibility
          return pino(
            { level: process.env.LOGGER_LEVEL || "info" },
            pino.destination("logs/operator_1_agents.log"),
          );
        default:
          return pino({ level: process.env.LOGGER_LEVEL || "info" });
      }

    default:
      return pino({ level: process.env.LOGGER_LEVEL || "info" });
  }
}

// Cleanup function to close all file descriptors
export function cleanup() {
  supervisorLogger.flush();
  registryLogger.flush();
  taskManagerLogger.flush();
  operatorLoggers.forEach((logger) => logger.flush());
}

// Handle process termination
process.on("beforeExit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
