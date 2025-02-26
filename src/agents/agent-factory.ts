import { BaseToolsFactory } from "@/base/tools-factory.js";
import { getChatLLM } from "@/helpers/llm.js";
import { Switches } from "@/index.js";
import { BeeAgent } from "bee-agent-framework/agents/bee/agent";
import { TokenMemory } from "bee-agent-framework/memory/tokenMemory";
import { UnconstrainedMemory } from "bee-agent-framework/memory/unconstrainedMemory";
import { BaseAgentFactory, CreateAgentInput } from "./base/agent-factory.js";
import { supervisor } from "./index.js";

export class AgentFactory extends BaseAgentFactory<BeeAgent> {
  createAgent<TCreateInput extends CreateAgentInput = CreateAgentInput>(
    input: TCreateInput,
    toolsFactory: BaseToolsFactory,
    switches?: Switches,
  ) {
    const llm = getChatLLM(input.agentKind);
    const generalInstructions = `You are a ${input.agentKind} kind of agent (agentId=${input.agentId}, agentType=${input.agentType}). ${input.instructions}`;
    switch (input.agentKind) {
      case "supervisor": {
        const tools = toolsFactory.createTools(input.tools);

        return new BeeAgent({
          meta: {
            name: input.agentId,
            description: input.description,
          },
          llm,
          memory: new UnconstrainedMemory(),
          tools,
          templates: {
            system: (template) =>
              template.fork((config) => {
                config.defaults.instructions = supervisor.SUPERVISOR_INSTRUCTIONS(
                  input.agentId,
                  switches,
                );
              }),
          },
        });
      }
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

  async runAgent(agent: BeeAgent, prompt: string): Promise<string> {
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
  }
}
