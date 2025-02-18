import { BeeAgent } from "bee-agent-framework/agents/bee/agent";
import { FrameworkError } from "bee-agent-framework/errors";
import "dotenv/config.js";

import { createAgent } from "./agents/agent-factory.js";
import * as operator from "./agents/operator.js";
import { AgentKindEnumSchema } from "./agents/registry/dto.js";
import { AgentRegistry } from "./agents/registry/registry.js";
import { agentStateLogger } from "./agents/state/logger.js";
import * as supervisor from "./agents/supervisor.js";
import { createConsoleReader } from "./helpers/reader.js";
import { TaskManager } from "./tasks/manager/manager.js";
import { taskStateLogger } from "./tasks/state/logger.js";
import { WorkspaceManager } from "./workspace/workspace-manager.js";

// Reset audit logs
agentStateLogger();
taskStateLogger();

const workspaceManager = WorkspaceManager.getInstance();
// Setup workspace
workspaceManager.setWorkspaceDirPath(["workspaces"]);
workspaceManager.setWorkspace("default");

const registry = new AgentRegistry<BeeAgent>({
  agentLifecycle: {
    async onCreate(
      config,
      agentId,
      toolsFactory,
    ): Promise<{ agentId: string; instance: BeeAgent }> {
      const { agentKind, agentType, instructions, description } = config;
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
  },
  onAgentConfigCreated(agentKind, agentType) {
    taskManager.registerAgentType(agentKind, agentType);
  },
});

const taskManager = new TaskManager(
  async (taskRun, taskManager, { onAgentCreate, onAgentComplete, onAgentError }) => {
    const agent = await registry.acquireAgent(taskRun.config.agentKind, taskRun.config.agentType);
    onAgentCreate(taskRun.taskRunId, agent.agentId, taskManager);
    const { instance } = agent;
    const prompt = taskRun.taskRunInput;
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
      .then((resp) =>
        onAgentComplete(resp.result.text, taskRun.taskRunId, agent.agentId, taskManager),
      )
      .catch((err) => onAgentError(err, taskRun.taskRunId, agent.agentId, taskManager));
  },
);

registry.registerToolsFactories([
  ["supervisor", new supervisor.ToolsFactory(registry, taskManager)],
  ["operator", new operator.ToolsFactory()],
]);

registry.restore();

if (
  !registry.isAgentConfigExists(AgentKindEnumSchema.Enum.supervisor, supervisor.AgentTypes.BOSS)
) {
  registry.createAgentConfig({
    autoPopulatePool: false,
    agentKind: AgentKindEnumSchema.Enum.supervisor,
    agentType: supervisor.AgentTypes.BOSS,
    instructions: "",
    tools: registry.getToolsFactory(AgentKindEnumSchema.Enum.supervisor).getAvailableToolsNames(),
    description: "The boss supervisor agent that control whole app.",
    maxPoolSize: 1,
  });
}

const { instance: supervisorAgent, agentId: supervisorAgentId } = await registry.acquireAgent(
  AgentKindEnumSchema.Enum.supervisor,
  supervisor.AgentTypes.BOSS,
);

taskManager.registerAdminAgent(supervisorAgentId);
taskManager.restore(supervisorAgentId);

// Can you create tasks to write poem about: sun, earth, mars and assign them to the right agent type and run them?
// Can you create agent type that will write the best poems on different topics, then create tasks to create poem about: sun, night, water. Assign them to the right agent types run all tasks and give me the created poems when it will be all finished?
// Can you create agent type that will write the best poems on different topics, then create tasks to create poem about: sun, night, water. Assign them to the right agent types?

// Can you create agent type that will write the best poems on different topics with the pool size 2?
// Can you create tasks to create poem about: sun, night, water, hell, love, hate. Assign them to the right agent types?
// Can you runt these tasks?
// Can you list their results?

// Can you generate poem for each of these topics: love, day, night?
// Can you get list of articles about each of these topics: deepseek, interstellar engine, agi?

// Can you create different kinds of specialized agents that will do a research on different aspects of person profile from internet? You should be very specific and explanatory in their instructions. Don't create any tasks.
// Base on these agents can you prepare related tasks. And one extra agent and task that will summarize task outputs other tasks.
// Can you create a personal profile of Dario Gil?

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
          // supervisorLogger;
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
