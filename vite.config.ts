import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    testTimeout: 60_000 * 5,
    setupFiles: ["dotenv/config"],
    fileParallelism: false,
    // pool: "threads",
    // poolOptions: {
    //   threads: {  minThreads: 1, maxThreads: 8 },
    //   // forks: { minForks: 7, maxForks: 8 },
    // },
    isolate: false,
    retry: 0,
  },
});
