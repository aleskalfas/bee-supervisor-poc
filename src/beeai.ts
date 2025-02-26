import "dotenv/config";
import { FrameworkError } from "bee-agent-framework";
import { PlatformSdk } from "./beeai/platform-sdk.js";
import { createConsoleReader } from "./helpers/reader.js";
import { createBeeSupervisor } from "./index.js";
import { CreateAgentConfig } from "./agents/registry/index.js";
import { AgentFactory } from "./beeai/agent-factory.js";

const platformSdk = PlatformSdk.getInstance();
await platformSdk.init(["gpt-researcher", "marketing-strategy"]);
const listedPlatformAgents = await platformSdk.listAgents();
const agentConfigFixtures = listedPlatformAgents.map(
  ({ beeAiAgentId, description }) =>
    ({
      agentKind: "operator",
      agentConfigVersion: 1,
      agentType: beeAiAgentId,
      description: description,
      autoPopulatePool: false,
      instructions: "Not used",
      tools: [],
      maxPoolSize: 10,
    }) as CreateAgentConfig,
);

const reader = createConsoleReader({ fallback: "What is the current weather in Las Vegas?" });
const supervisorAgent = await createBeeSupervisor({
  agentConfigFixtures,
  agentFactory: new AgentFactory(),
  switches: {
    agentRegistry: {
      mutableAgentConfigs: false,
      restoration: false,
    },
    taskManager: {
      restoration: false,
    },
  },
  workspace: "beeai",
});
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
