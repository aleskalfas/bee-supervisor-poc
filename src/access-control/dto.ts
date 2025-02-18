import { z } from "zod";

export const PermissionSchema = z.enum(["read", "write", "execute"]);
export type Permission = z.infer<typeof PermissionSchema>;
