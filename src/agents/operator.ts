import { ArXivTool } from "bee-agent-framework/tools/arxiv";
import { DuckDuckGoSearchTool } from "bee-agent-framework/tools/search/duckDuckGoSearch";
import { BaseToolsFactory, ToolFactoryMethod } from "@/base/tools-factory.js";

export class ToolsFactory extends BaseToolsFactory {
  async getFactoriesMethods(): Promise<ToolFactoryMethod[]> {
    return [() => new DuckDuckGoSearchTool(), () => new ArXivTool()];
  }
}
