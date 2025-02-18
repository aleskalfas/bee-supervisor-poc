import { Logger } from "bee-agent-framework";
import { AnyTool } from "bee-agent-framework/tools/base";
import { AvailableTool } from "src/agents/registry/dto.js";

export type ToolFactoryMethod = () => AnyTool;

export abstract class BaseToolsFactory {
  protected readonly availableTools = new Map<string, AvailableTool>();
  protected readonly factories = new Map<string, ToolFactoryMethod>();
  private readonly logger: Logger;

  constructor() {
    this.logger = Logger.root.child({ name: this.constructor.name });
    for (const factory of this.getFactoriesMethods()) {
      const product = factory();
      this.availableTools.set(product.name, {
        name: product.name,
        description: product.description,
      });
      this.factories.set(product.name, factory);
    }
  }

  abstract getFactoriesMethods(): ToolFactoryMethod[];

  getAvailableTools(): AvailableTool[] {
    return Array.from(this.availableTools.values());
  }

  getAvailableToolsNames(): string[] {
    return Array.from(this.availableTools.keys());
  }

  createTools(tools: string[]): AnyTool[] {
    return tools.map((t) => {
      const factory = this.factories.get(t);
      if (!factory) {
        throw new Error(`Undefined tool ${t}`);
      }
      return factory();
    });
  }
}
