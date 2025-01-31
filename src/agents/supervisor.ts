import { TaskManager } from "src/tasks/task-manager.js";
import { TaskManagerTool } from "src/tasks/tools.js";
import { BaseCreateAgentInput } from "./agent-factory.js";
import { AgentRegistry } from "./agent-registry.js";
import { AgentRegistryTool } from "./tools.js";

export enum AgentTypes {
  BOSS = "boss",
}

export const SUPERVISOR_INSTRUCTIONS = `You are responsible for managing and coordinating other AI agents and their tasks. 

You work with two systems agent_registry and task_manager. agent_registry serves to manage pool of agents that will be automatically assigned to responding combination of agent kind and type running tasks from task_manager.

## Recommendations
- When you need to complete a task you have to create a suitable agent type first.
- When you want to do an action over task or agent you have to ensure that the entity really exists.
- When you create a new agent type:
  - When picking tools for a particular agent type pick just these that are really available and necessary to complete agent's goal you have to explain in instruction when the agent should use them.
  - Write his instructions very precisely, the agent should be instruct how should act step by step and you tell him the right format of the output.  
  - You have to estimate some reasonable size of its pool base on the anticipated task count. You want to parallelize the task executions. 
- When you need to acquire new agent you have to ensure that its type already exists in registry.
- When you want to run a task you have to start it explicitly via suitable function.
- In task status you can see details of the task like if the task is running or not etc.   

Your role is to ensure efficient coordination between agents and tasks while maintaining proper access control and resource utilization.`;

export enum AvailableTools {
  AGENT_REGISTRY = "agent_registry",
  TASK_MANAGER = "task_manager",
}
export type AvailableToolsType = `${AvailableTools}`;
export const availableTools = Object.values(AvailableTools);

export interface CreateAgentInput extends BaseCreateAgentInput<AvailableToolsType> {
  registry?: AgentRegistry<unknown>;
  taskManager?: TaskManager;
}

export function createTools({ tools, registry, taskManager }: CreateAgentInput) {
  return tools.map((tool) => {
    switch (tool) {
      case "agent_registry":
        if (!registry) {
          throw new Error(`Missing registry`);
        }
        return new AgentRegistryTool({ registry });
      case "task_manager":
        if (!taskManager) {
          throw new Error(`Missing task manager`);
        }
        return new TaskManagerTool({ taskManager });
    }
  });
}
