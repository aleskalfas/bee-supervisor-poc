import { BaseToolsFactory } from "@/base/tools-factory.js";
import { AgentKindEnum } from "../registry/dto.js";
import { Switches } from "@/index.js";

export interface CreateAgentInput {
  agentKind: AgentKindEnum;
  agentType: string;
  agentId: string;
  instructions: string;
  description: string;
  tools: string[];
}

export abstract class BaseAgentFactory<TAgent> {
  abstract createAgent(
    input: CreateAgentInput,
    toolsFactory: BaseToolsFactory,
    switches?: Switches,
  ): TAgent;
  abstract runAgent(agent: TAgent, prompt: string): Promise<string>;
}
