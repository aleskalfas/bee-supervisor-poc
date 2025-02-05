import { BeeAgent } from "bee-agent-framework/agents/bee/agent";
import { FrameworkError } from "bee-agent-framework/errors";
import "dotenv/config.js";

import { createAgent } from "./agents/agent-factory.js";
import { AgentKindSchema, AgentRegistry } from "./agents/agent-registry.js";
import { createConsoleReader } from "./helpers/reader.js";
import { TaskManager } from "./tasks/task-manager.js";
import * as supervisor from "./agents/supervisor.js";
import * as operator from "./agents/operator.js";

const registry = new AgentRegistry<BeeAgent>({
  async onCreate(
    { kind, tools, type, instructions, description },
    poolStats,
    toolsFactory,
  ): Promise<{ id: string; instance: BeeAgent }> {
    const num = poolStats.created + 1;
    const id = `${kind}:${type}[${num}]`;
    tools = tools == null ? toolsFactory.getAvailableToolsNames() : tools;
    const instance = createAgent(
      {
        agentKind: kind,
        agentType: type,
        agentId: id,
        description,
        instructions,
        tools,
      },
      toolsFactory,
    );

    return { id, instance };
  },
  async onDestroy(instance) {
    instance.destroy();
  },
});

const taskManager = new TaskManager(async (task) => {
  const { instance: agent } = await registry.acquireAgent(task.agentKind, task.agentType);
  const prompt = task.input;
  const resp = await agent.run(
    { prompt },
    {
      execution: {
        maxIterations: 8,
        maxRetriesPerStep: 2,
        totalMaxRetries: 10,
      },
    },
  );
  return resp.result.text;
});

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

const { instance: supervisorAgent, agentId: supervisorAgentId } = await registry.acquireAgent(
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

// Can you create poems on each of these topics: night, sky, fall, love, hate?
// Can you get list of articles about each of these topics: deepseek, interstellar engine, agi?

const reader = createConsoleReader({ fallback: "What is the current weather in Las Vegas?" });
for await (const { prompt } of reader) {
  try {
    const response = await supervisorAgent
      .run(
        {
          prompt: `# State
- Active agents: ${JSON.stringify(registry.getActiveAgents().map(({ id, kind, type, inUse }) => ({ id, kind, type, inUse })))}
- Active tasks: ${JSON.stringify(taskManager.getAllTaskStatuses(supervisorAgentId).map(({ id, isRunning, isOccupied, isCompleted, nextRunAt, lastRunAt, ownerAgentId, currentAgentId, occupiedSince }) => ({ id, isRunning, isOccupied, isCompleted, nextRunAt, lastRunAt, ownerAgentId, currentAgentId, occupiedSince })))}

${prompt}`,
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
