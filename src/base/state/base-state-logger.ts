import { appendFileSync, copyFileSync, existsSync, truncateSync, writeFileSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { LogInit, LogUpdate } from "./dto.js";

export class BaseStateLogger<TData extends z.ZodType> {
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

      // Copy existing file to backup
      copyFileSync(this.logPath, backupPath);

      // Clear the contents of the original file
      truncateSync(this.logPath, 0);
    } else {
      // Create new empty log file if it doesn't exist
      writeFileSync(this.logPath, "");
    }
  }

  private logInit() {
    this.logUpdate({ type: "@log_init" });
  }

  protected logUpdate(update: Omit<LogUpdate<TData>, "timestamp"> | Omit<LogInit, "timestamp">) {
    const timestamp = new Date().toISOString();
    appendFileSync(this.logPath, JSON.stringify({ ...update, timestamp }) + "\n");
  }
}
