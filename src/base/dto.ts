import { z } from "zod";

export const DateStringSchema = z.union([z.string().transform((str) => new Date(str)), z.date()]);
