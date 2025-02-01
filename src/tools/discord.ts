// import { LangChainTool } from "bee-agent-framework/adapters/langchain/tools";
import { AnyTool } from "bee-agent-framework/tools/base";
// import {
//   DiscordGetMessagesTool,
//   DiscordSendMessagesTool,
// } from "@langchain/community/tools/discord";

// FIXME
export function getDiscordTools(): AnyTool[] {
  return [
    // new LangChainTool({
    //   tool: new DiscordGetMessagesTool(),
    // }),
    // new LangChainTool({
    //   tool: new DiscordSendMessagesTool(),
    // }),
  ];
}
