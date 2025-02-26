import "dotenv/config";
import { FrameworkError, Logger } from "bee-agent-framework";
import { PlatformSdk } from "./beeai/platform-sdk.js";
import { createConsoleReader } from "./helpers/reader.js";
import { createBeeSupervisor } from "./index.js";
import { CreateAgentConfig } from "./agents/registry/index.js";
import { AgentFactory } from "./beeai/agent-factory.js";
import { z } from "zod";

const logger = Logger.root.child({ name: "beeai" });

// ****************************************************************************************************
// Handle arguments
// ****************************************************************************************************
const ArgSchema = z.object({
  prompt: z.string(),
  availableAgents: z.array(z.string()),
});
type Args = z.infer<typeof ArgSchema>;

function parseArguments(): Args {
  try {
    // Get the first command line argument
    // process.argv[0] is the path to node
    // process.argv[1] is the path to your script
    // process.argv[2] is the first actual argument
    const argString = process.argv[2];

    if (!argString) {
      throw new Error("No argument provided");
    }

    // Parse the JSON string to an object
    const parsedArg = JSON.parse(argString);

    // Validate against the schema
    const validatedArgs = ArgSchema.parse(parsedArg);

    return validatedArgs;
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.error(error.errors, "Validation error:");
    } else if (error instanceof SyntaxError) {
      logger.error(error.message, "Invalid JSON:");
    } else {
      logger.error(error, "Error:");
    }
    process.exit(1);
  }
}
const args = parseArguments();

// ****************************************************************************************************
// Connect platform
// ****************************************************************************************************
const platformSdk = PlatformSdk.getInstance();
await platformSdk.init(args.availableAgents.map((a) => a.toLocaleLowerCase()));
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

// ****************************************************************************************************
// Init supervisor
// ****************************************************************************************************
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

// ****************************************************************************************************
// Run
// ****************************************************************************************************
// npm run start:beeai '{"prompt":"Prepare a marketing strategy to sell most selling mobile phones in 2024 in Europe on my eshop. Ensure the strategy is based on top of thorough research of the market.", "availableAgents":["gpt-researcher","marketing-strategy"]}'

const reader = createConsoleReader({
  fallback: "What is the current weather in Las Vegas?",
});
try {
  const response = await supervisorAgent
    .run(
      {
        prompt: args.prompt,
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
} finally {
  reader.close();
}
