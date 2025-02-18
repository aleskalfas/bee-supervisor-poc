import { Logger } from "bee-agent-framework";
import { AgentIdValue } from "src/agents/registry/dto.js";
import { WorkspaceManager, WorkspaceResource } from "src/workspace/workspace-manager.js";

export abstract class WorkspaceRestorable {
  protected readonly logger: Logger;
  protected workspaceManager: WorkspaceManager;
  protected resource: WorkspaceResource;
  protected resourceOwnerId: string;

  constructor(path: readonly string[], resourceOwnerId: string) {
    this.logger = Logger.root.child({ name: this.constructor.name });
    this.resourceOwnerId = resourceOwnerId;
    this.workspaceManager = WorkspaceManager.getInstance();
    this.resource = this.workspaceManager.registerResource(
      {
        kind: "file",
        path,
      },
      resourceOwnerId,
    );
  }

  persist(): void {
    const entities = this.getSerializedEntities();
    this.workspaceManager.writeResource(this.resource.path, this.resourceOwnerId, entities);
  }

  protected abstract getSerializedEntities(): string;

  restore(actingAgentId: AgentIdValue): void {
    this.workspaceManager.readResource(
      this.resource.path,
      this.resourceOwnerId,
      (resource, content) => {
        this.restoreEntity(resource, content, actingAgentId);
      },
    );
  }

  protected abstract restoreEntity(
    resource: WorkspaceResource,
    line: string,
    actingAgentId: AgentIdValue,
  ): void;
}
