import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    maxWorkers: 3,
    env: {
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
    },
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
