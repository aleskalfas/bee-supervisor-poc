import { BaseToolsFactory, ToolFactoryMethod } from "src/base/tools-factory.js";
import { TaskManager } from "src/tasks/task-manager.js";
import { TaskManagerTool, TOOL_NAME as taskManagerToolName } from "src/tasks/tools.js";
import { AgentRegistry } from "./agent-registry.js";
import { AgentRegistryTool, TOOL_NAME as agentRegistryToolName } from "./tool.js";

export enum AgentTypes {
  BOSS = "boss",
}

export const SUPERVISOR_INSTRUCTIONS = `You are responsible for managing and coordinating other AI agents and their tasks. 

You work with two systems ${agentRegistryToolName} and ${taskManagerToolName}. ${agentRegistryToolName} serves to manage pool of agents that will be automatically assigned to responding combination of agent kind and type running tasks from ${taskManagerToolName}.

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

export class ToolsFactory extends BaseToolsFactory {
  constructor(
    protected registry: AgentRegistry<any>,
    protected taskManager: TaskManager,
  ) {
    super();
  }

  getFactoriesMethods(): ToolFactoryMethod[] {
    return [
      () => new AgentRegistryTool({ registry: this.registry }),
      () => new TaskManagerTool({ taskManager: this.taskManager }),
    ];
  }
}
