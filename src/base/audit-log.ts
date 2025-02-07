import { appendFileSync, existsSync, renameSync, writeFileSync } from "fs";
import { join } from "path";

export interface LogUpdate<TType, TData> {
  timestamp: string;
  type: TType;
  taskId: string;
  data: TData;
}

export class BaseAuditLog<TType, TData> {
  protected logPath: string;

  constructor(logFileDefaultPath: readonly string[], logFileDefaultName: string, logPath?: string) {
    if (!logPath) {
      this.logPath = join(process.cwd(), ...logFileDefaultPath, `${logFileDefaultName}.log`);
    } else {
      this.logPath = logPath;
    }
    this.rotateLogFileIfExists();
  }

  private rotateLogFileIfExists(): void {
    if (existsSync(this.logPath)) {
      // Generate timestamp for the backup file
      const timestamp = new Date()
        .toISOString()
        .replace(/:/g, "-") // Replace colons with dashes for file name compatibility
        .replace(/\./g, "-"); // Replace dots with dashes

      // Create backup file path
      const backupPath = this.logPath.replace(".log", `.${timestamp}.log`);

      // Rename existing file to backup
      renameSync(this.logPath, backupPath);

      // Create new empty log file
      writeFileSync(this.logPath, "");
    }
  }

  protected logUpdate(update: LogUpdate<TType, TData>) {
    appendFileSync(this.logPath, JSON.stringify(update) + "\n");
  }
}
