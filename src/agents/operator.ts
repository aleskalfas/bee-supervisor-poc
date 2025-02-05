// import { DuckDuckGoSearchTool } from "bee-agent-framework/tools/search/duckDuckGoSearch";
import { ArXivTool } from "bee-agent-framework/tools/arxiv";
import { DuckDuckGoSearchTool } from "bee-agent-framework/tools/search/duckDuckGoSearch";
import { BaseToolsFactory, ToolFactoryMethod } from "src/base/tools-factory.js";

// export enum AvailableToolEnum {
//   // DUCK_DUCK_GO = "duckDuckGo",
//   ARXIV = "arxiv",
// }

// export type AvailableToolType = `${AvailableToolEnum}`;

// const toolsMap = new Map<AvailableToolType, () => AnyTool>([
//   // [AvailableTools.DUCK_DUCK_GO, new DuckDuckGoSearchTool()],
//   [AvailableToolEnum.ARXIV, () => new ArXivTool()],
// ]);

// export const availableToolValues = Object.values(AvailableToolEnum);
// export function getAvailableTools(tools: AvailableToolType[]): AvailableTool[] {
//   return tools
//     .map((t) => toolsMap.get(t))
//     .filter((t) => !!t)
//     .map((t) => {
//       const tool = t();
//       return JSON.stringify({ name: tool.name, description: tool.description });
//     });
// }

// export interface CreateAgentInput extends BaseCreateAgentInput<AvailableToolType> {}

// export function createTools({ tools }: CreateAgentInput) {
//   return tools
//     .map((t) => toolsMap.get(t))
//     .filter((t) => !!t)
//     .map((t) => t());
// }

export class ToolsFactory extends BaseToolsFactory {
  getFactoriesMethods(): ToolFactoryMethod[] {
    return [() => new DuckDuckGoSearchTool(), () => new ArXivTool()];
  }
}
