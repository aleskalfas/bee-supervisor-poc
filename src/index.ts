import { AgentKindEnumSchema } from "@agents/registry/dto.js";
import {
  AgentRegistry,
  AgentRegistrySwitches,
  CreateAgentConfig,
} from "@agents/registry/registry.js";
import { AgentStateLogger } from "@agents/state/logger.js";
import { TaskManager, TaskManagerSwitches } from "@tasks/manager/manager.js";
import { TaskStateLogger } from "@tasks/state/logger.js";
import { WorkspaceManager } from "@workspaces/manager/manager.js";
import "dotenv/config";
import { BaseAgentFactory } from "./agents/base/agent-factory.js";
import { operator, supervisor } from "./agents/index.js";
import { AgentFactory } from "./beeai/agent-factory.js";
import { BeeAgent } from "bee-agent-framework/agents/bee/agent";

export interface Switches {
  taskManager?: TaskManagerSwitches;
  agentRegistry?: AgentRegistrySwitches;
}

export interface CreateBeeSupervisorConfig {
  agentConfigFixtures?: CreateAgentConfig[];
  agentFactory?: BaseAgentFactory<unknown>;
  workspace?: string;
  switches?: Switches;
}

export async function createBeeSupervisor({
  agentFactory,
  agentConfigFixtures,
  workspace,
  switches,
}: CreateBeeSupervisorConfig): Promise<BeeAgent> {
  // Reset audit logs
  AgentStateLogger.init();
  TaskStateLogger.init();

  // Setup workspace
  WorkspaceManager.init(["workspaces"], workspace ?? "default");

  let _agentFactory = agentFactory;
  if (_agentFactory == null) {
    // Default agent factory
    _agentFactory = new AgentFactory();
  }

  const registry = new AgentRegistry<ReturnType<typeof _agentFactory.createAgent>>({
    switches: switches?.agentRegistry,
    agentLifecycle: {
      async onCreate(
        config,
        agentId,
        toolsFactory,
      ): Promise<{ agentId: string; instance: ReturnType<typeof _agentFactory.createAgent> }> {
        const { agentKind, agentType, instructions, description } = config;
        const tools = config.tools == null ? toolsFactory.getAvailableToolsNames() : config.tools;

        const instance = _agentFactory.createAgent(
          {
            agentKind,
            agentType,
            agentId,
            description,
            instructions,
            tools,
          },
          toolsFactory,
          switches,
        );

        return { agentId, instance };
      },
      async onDestroy(/** instance */) {
        // FIXME Not all agents support destruction
        // instance.destroy();
      },
    },
    onAgentConfigCreated(agentKind, agentType) {
      taskManager.registerAgentType(agentKind, agentType);
    },
    onAgentAvailable(agentKind, agentType, agentConfigVersion, availableCount) {
      taskManager.agentAvailable(agentKind, agentType, agentConfigVersion, availableCount);
    },
  });

  const taskManager = new TaskManager({
    switches: switches?.taskManager,
    onTaskStart: async (
      taskRun,
      taskManager,
      { onAwaitingAgentAcquired, onAgentAcquired, onAgentComplete, onAgentError },
    ) => {
      let agent;
      try {
        agent = await registry.acquireAgent(taskRun.config.agentKind, taskRun.config.agentType);
      } catch (err) {
        console.error(err);
        onAwaitingAgentAcquired(taskRun.taskRunId, taskManager);
        return;
      }

      onAgentAcquired(taskRun.taskRunId, agent.agentId, taskManager);
      const { instance } = agent;
      const prompt = taskRun.taskRunInput;

      _agentFactory
        .runAgent(instance, prompt)
        .then((resp) => onAgentComplete(resp, taskRun.taskRunId, agent.agentId, taskManager))
        .catch((err) => {
          onAgentError(err, taskRun.taskRunId, agent.agentId, taskManager);
        })
        .finally(() => {
          registry.releaseAgent(agent.agentId);
        });
    },
  });

  await registry.registerToolsFactories([
    [
      "supervisor",
      new supervisor.ToolsFactory(
        registry,
        taskManager,
        supervisor.Workdir.getWorkdirPath().validPath,
      ),
    ],
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

  if (agentConfigFixtures?.length) {
    for (const fixture of agentConfigFixtures) {
      registry.createAgentConfig(fixture);
    }
  }

  const { instance: supervisorAgent, agentId: supervisorAgentId } = await registry.acquireAgent(
    AgentKindEnumSchema.Enum.supervisor,
    supervisor.AgentTypes.BOSS,
  );

  taskManager.registerAdminAgent(supervisorAgentId);
  taskManager.restore(supervisorAgentId);

  supervisor.Workdir.registerWorkdir(supervisorAgentId);

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

  // Prepare a marketing strategy to sell most selling mobile phones in 2024 in Europe on my eshop. Ensure the strategy is based on top of thorough research of the market.

  return supervisorAgent as BeeAgent;
}
