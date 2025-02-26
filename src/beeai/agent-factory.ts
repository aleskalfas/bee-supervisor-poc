import { BaseAgentFactory, CreateAgentInput } from "@/agents/base/agent-factory.js";
import { supervisor } from "@/agents/index.js";
import { AgentIdValue } from "@/agents/registry/dto.js";
import { BaseToolsFactory } from "@/base/tools-factory.js";
import { getChatLLM } from "@/helpers/llm.js";
import { Switches } from "@/index.js";
import { agentType } from "@/ui/config.js";
import { BeeAgent } from "bee-agent-framework/agents/bee/agent";
import { UnconstrainedMemory } from "bee-agent-framework/memory/unconstrainedMemory";
import { PlatformSdk } from "./platform-sdk.js";

class BeeAiAgent {
  constructor(
    private _agentId: AgentIdValue,
    private _description: string,
    private _beeAiAgentId: string,
  ) {}

  get agentId() {
    return this._agentId;
  }

  get description() {
    return this._description;
  }

  get beeAiAgentId() {
    return this._beeAiAgentId;
  }
}

export type AgentType = BeeAiAgent | BeeAgent;

export class AgentFactory extends BaseAgentFactory<AgentType> {
  createAgent(
    input: CreateAgentInput,
    toolsFactory: BaseToolsFactory,
    switches?: Switches,
  ): AgentType {
    switch (input.agentKind) {
      case "supervisor": {
        const llm = getChatLLM(input.agentKind);
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
        return new BeeAiAgent(input.agentId, input.description, input.agentType);
      default:
        throw new Error(`Undefined agent kind agentKind:${input.agentKind}`);
    }
  }
  async runAgent(agent: AgentType, prompt: string) {
    if (agent instanceof BeeAgent) {
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

    if (agent instanceof BeeAiAgent) {
      const resp = await PlatformSdk.getInstance().runAgent(agent.beeAiAgentId, prompt);
      return String(resp.output.text);
    }

    throw new Error(`Undefined agent ${agentType}`);
  }
}
