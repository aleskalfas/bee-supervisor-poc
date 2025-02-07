import { pino, Logger } from "pino";
import fs from "fs";
import { AgentKind } from "src/agents/agent-registry.js";

// Ensure logs directory exists
if (!fs.existsSync("logs")) {
  fs.mkdirSync("logs");
}

// Create separate log files for different components
const supervisorLogger: Logger = pino(
  {
    level: process.env.LOGGER_LEVEL || "info",
  },
  pino.destination("logs/supervisor_agents.log"),
);

const registryLogger: Logger = pino(
  {
    level: process.env.LOGGER_LEVEL || "info",
  },
  pino.destination("logs/agent_registry.log"),
);

const taskManagerLogger: Logger = pino(
  {
    level: process.env.LOGGER_LEVEL || "info",
  },
  pino.destination("logs/task_manager.log"),
);

// Cache for operator loggers
const operatorLoggers = new Map<number, Logger>();

export enum LoggerType {
  AGENT = "agent",
  REGISTRY = "registry",
  TASK_MANAGER = "taskManager",
}

/**
 * Get a logger instance for a specific component
 * @param type - The type of logger to get
 * @param operatorId - Optional operator ID for operator-specific loggers
 * @returns A pino logger instance
 */
export function getLogger(
  type: LoggerType,
  agentKind?: AgentKind,
  operatorId?: number | null,
): Logger {
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
          if (operatorId !== null && operatorId !== undefined) {
            if (!operatorLoggers.has(operatorId)) {
              operatorLoggers.set(
                operatorId,
                pino(
                  { level: process.env.LOGGER_LEVEL || "info" },
                  pino.destination(`logs/operator_${operatorId}_agents.log`),
                ),
              );
            }
            return operatorLoggers.get(operatorId)!;
          }
          // Default operator logger for backward compatibility
          return pino(
            { level: process.env.LOGGER_LEVEL || "info" },
            pino.destination("logs/operator_1_agents.log"),
          );
        default:
          return pino({ level: process.env.LOGGER_LEVEL || "info" });
      }
      break;

    default:
      return pino({ level: process.env.LOGGER_LEVEL || "info" });
  }
}

/**
 * Cleanup function to close all file descriptors
 */
export function cleanup(): void {
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
