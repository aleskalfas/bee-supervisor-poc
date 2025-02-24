import * as supervisor from "./supervisor.js";
import { BeeAgent } from "bee-agent-framework/agents/bee/agent";
import { UnconstrainedMemory } from "bee-agent-framework/memory/unconstrainedMemory";
import { TokenMemory } from "bee-agent-framework/memory/tokenMemory";
import { BaseToolsFactory } from "@/base/tools-factory.js";
import { AgentKindEnum } from "./registry/dto.js";
import { getChatLLM } from "@/helpers/llm.js";

export interface BaseCreateAgentInput {
  agentKind: AgentKindEnum;
  agentType: string;
  agentId: string;
  instructions: string;
  description: string;
  tools: string[];
}

export function createAgent<TInput extends BaseCreateAgentInput>(
  input: TInput,
  toolsFactory: BaseToolsFactory,
) {
  const llm = getChatLLM(input.agentKind);
  const generalInstructions = `You are a ${input.agentKind} kind of agent (agentId=${input.agentId}, agentType=${input.agentType}). ${input.instructions}`;
  switch (input.agentKind) {
    case "supervisor":
      return new BeeAgent({
        meta: {
          name: input.agentId,
          description: input.description,
        },
        llm,
        memory: new UnconstrainedMemory(),
        tools: toolsFactory.createTools(input.tools),
        templates: {
          system: (template) =>
            template.fork((config) => {
              config.defaults.instructions = `${supervisor.SUPERVISOR_INSTRUCTIONS(input.agentKind, input.agentType, input.agentId)}\n\n${generalInstructions}`;
            }),
        },
      });
    case "operator":
      return new BeeAgent({
        meta: {
          name: input.agentId,
          description: input.description,
        },
        llm,
        memory: new TokenMemory({ llm }),
        tools: toolsFactory.createTools(input.tools),
        templates: {
          system: (template) =>
            template.fork((config) => {
              config.defaults.instructions = generalInstructions;
            }),
        },
      });
    default:
      throw new Error(`Undefined agent kind agentKind:${input.agentKind}`);
  }
}
