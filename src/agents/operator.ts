// import { DuckDuckGoSearchTool } from "bee-agent-framework/tools/search/duckDuckGoSearch";
import { BaseCreateAgentInput } from "./agent-factory.js";
// import { ArXivTool } from "bee-agent-framework/tools/arxiv";
import { AnyTool } from "bee-agent-framework/tools/base";

export enum AvailableTools {}
// DUCK_DUCK_GO = "duckDuckGo",
// ARXIV = "arxiv",
export type AvailableToolsType = `${AvailableTools}`;
export const availableTools = Object.values(AvailableTools);

export interface CreateAgentInput extends BaseCreateAgentInput<AvailableToolsType> {}

const toolsMap = new Map<AvailableToolsType, AnyTool>([
  // [AvailableTools.DUCK_DUCK_GO, new DuckDuckGoSearchTool()],
  // [AvailableTools.ARXIV, new ArXivTool()],
]);

export function createTools({ tools }: CreateAgentInput) {
  return tools.map((t) => toolsMap.get(t)).filter((t) => !!t);
}
