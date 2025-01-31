import { getChatLLM } from "src/helpers/llm.js";
import { AgentKind } from "./agent-registry.js";
import * as supervisor from "./supervisor.js";
import * as operator from "./operator.js";
import { BeeAgent } from "bee-agent-framework/agents/bee/agent";
import { UnconstrainedMemory } from "bee-agent-framework/memory/unconstrainedMemory";
import { TokenMemory } from "bee-agent-framework/memory/tokenMemory";

export interface BaseCreateAgentInput<TAvailableTools> {
  agentKind: AgentKind;
  agentType: string;
  agentId: string;
  instructions: string;
  description: string;
  tools: TAvailableTools[];
}

export function createAgent<TInput extends BaseCreateAgentInput<unknown>>(input: TInput) {
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
        tools: supervisor.createTools(input as supervisor.CreateAgentInput),
        templates: {
          system: (template) =>
            template.fork((config) => {
              config.defaults.instructions = `${supervisor.SUPERVISOR_INSTRUCTIONS}\n\n${generalInstructions}`;
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
        tools: operator.createTools(input as operator.CreateAgentInput),
        templates: {
          system: (template) =>
            template.fork((config) => {
              config.defaults.instructions = generalInstructions;
            }),
        },
      });
  }
}
