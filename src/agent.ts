import { BeeAgent } from "bee-agent-framework/agents/bee/agent";
import { FrameworkError } from "bee-agent-framework/errors";
import "dotenv/config.js";

import { createAgent } from "./agents/agent-factory.js";
import { AgentKindSchema, AgentRegistry } from "./agents/agent-registry.js";
import * as operator from "./agents/operator.js";
import * as supervisor from "./agents/supervisor.js";
import { createConsoleReader } from "./helpers/reader.js";
import { TaskManager } from "./tasks/task-manager.js";
import { getLogger, LoggerType } from "./helpers/tmux-logger.js";
import { agentIdToString } from "./agents/utils.js";

const registry = new AgentRegistry<BeeAgent>({
  async onCreate(
    config,
    poolStats,
    toolsFactory,
  ): Promise<{ agentId: string; instance: BeeAgent }> {
    const { kind: agentKind, type: agentType, instructions, description } = config;
    const num = poolStats.created + 1;
    const agentId = agentIdToString({ agentKind, agentType, num });
    const tools = config.tools == null ? toolsFactory.getAvailableToolsNames() : config.tools;
    const instance = createAgent(
      {
        agentKind,
        agentType,
        agentId,
        description,
        instructions,
        tools,
      },
      toolsFactory,
    );

    return { agentId, instance };
  },
  async onDestroy(instance) {
    instance.destroy();
  },
});

const taskManager = new TaskManager(
  async (task, taskManager, { onAgentCreate, onAgentComplete, onAgentError }) => {
    const agent = await registry.acquireAgent(task.agentKind, task.agentType);
    onAgentCreate(task.id, agent.agentId, taskManager);
    const { instance } = agent;
    const prompt = task.input;
    instance
      .run(
        { prompt },
        {
          execution: {
            maxIterations: 8,
            maxRetriesPerStep: 2,
            totalMaxRetries: 10,
          },
        },
      )
      .observe((emitter) => {
        emitter.on("update", (data, meta) => {
          reader.write(
            `${(meta.creator as any).input.meta.name} 🤖 (${data.update.key}) :`,
            data.update.value,
          );
        });
        emitter.on("error", (data, meta) => {
          reader.write(
            `${(meta.creator as any).input.meta.name} 🤖 (${data.error.name}) :`,
            data.error.message,
          );
        });
      })
      .then((resp) => onAgentComplete(resp.result.text, task.id, agent.agentId, taskManager))
      .catch((err) => onAgentError(err, task.id, agent.agentId, taskManager))
      .finally(async () => {
        await registry.releaseAgent(agent.agentId);
      });
  },
);

registry.registerToolsFactories([
  ["supervisor", new supervisor.ToolsFactory(registry, taskManager)],
  ["operator", new operator.ToolsFactory()],
]);

registry.registerAgentType({
  autoPopulatePool: false,
  kind: AgentKindSchema.Enum.supervisor,
  type: supervisor.AgentTypes.BOSS,
  instructions: "",
  description: "The boss supervisor agent that control whole app.",
  maxPoolSize: 1,
});

const { instance: supervisorAgent } = await registry.acquireAgent(
  AgentKindSchema.Enum.supervisor,
  supervisor.AgentTypes.BOSS,
);

// Can you create tasks to write poem about: sun, earth, mars and assign them to the right agent type and run them?
// Can you create agent type that will write the best poems on different topics, then create tasks to create poem about: sun, night, water. Assign them to the right agent types run all tasks and give me the created poems when it will be all finished?
// Can you create agent type that will write the best poems on different topics, then create tasks to create poem about: sun, night, water. Assign them to the right agent types?

// Can you create agent type that will write the best poems on different topics with the pool size 2?
// Can you create tasks to create poem about: sun, night, water, hell, love, hate. Assign them to the right agent types?
// Can you runt these tasks?
// Can you list their results?

// Can you generate poem for each of these topics: love, day, night?
// Can you get list of articles about each of these topics: deepseek, interstellar engine, agi?

const supervisorLogger = getLogger(LoggerType.AGENT, "supervisor");

const reader = createConsoleReader({ fallback: "What is the current weather in Las Vegas?" });
for await (const { prompt } of reader) {
  try {
    const response = await supervisorAgent
      .run(
        {
          prompt,
        },
        {
          execution: {
            maxIterations: 100,
            maxRetriesPerStep: 2,
            totalMaxRetries: 10,
          },
        },
      )
      .observe((emitter) => {
        emitter.on("update", (data, meta) => {
          supervisorLogger;
          reader.write(
            `${(meta.creator as any).input.meta.name} 🤖 (${data.update.key}) :`,
            data.update.value,
          );
        });
      });

    reader.write(`Agent 🤖 :`, response.result.text);
  } catch (error) {
    reader.write(`Error`, FrameworkError.ensure(error).dump());
  }
}
