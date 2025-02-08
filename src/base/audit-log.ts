import { appendFileSync, existsSync, renameSync, writeFileSync } from "fs";
import { join } from "path";

export interface LogUpdate<TType, TData> {
  timestamp: string;
  type: TType;
  data: TData;
}

export interface LogInit {
  timestamp: string;
  type: "@log_init";
}

export class BaseAuditLog<TType, TData, TLogUpdate extends LogUpdate<TType, TData>> {
  protected logPath: string;

  constructor(logFileDefaultPath: readonly string[], logFileDefaultName: string, logPath?: string) {
    if (!logPath) {
      this.logPath = join(process.cwd(), ...logFileDefaultPath, `${logFileDefaultName}.log`);
    } else {
      this.logPath = logPath;
    }
    this.rotateLogFileIfExists();
    this.logInit();
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

  private logInit() {
    this.logUpdate({ type: "@log_init" });
  }

  protected logUpdate(update: Omit<TLogUpdate, "timestamp"> | Omit<LogInit, "timestamp">) {
    const timestamp = new Date().toISOString();
    appendFileSync(this.logPath, JSON.stringify({ ...update, timestamp }) + "\n");
  }
}
