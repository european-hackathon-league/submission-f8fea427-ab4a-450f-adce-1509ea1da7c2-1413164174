import { configDefaults, defineConfig } from "vitest/config";
import { loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
function contractHarness(failAssetOnce: boolean): Plugin {
  let dispose: (() => Promise<void>) | undefined;
  return {
    name: "frontend-synthetic-contract-harness",
    apply: "serve",
    async closeBundle() {
      await dispose?.();
    },
    async configureServer(server) {
      const { createContractHarness } = await server.ssrLoadModule(
        "/testing/contractHarness.ts",
      );
      const harness = createContractHarness({
        failAssetOnce,
        loadTransport: async (scenario: string) => {
          const module = await server.ssrLoadModule("/src/api/mock.ts");
          return module.createMockTransport(scenario);
        },
      });
      dispose = harness.dispose;
      server.middlewares.use((req, res, next) => {
        void harness.middleware(req, res, next);
      });
      server.httpServer?.once("close", () => {
        void harness.dispose();
      });
    },
  };
}
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    server: {
      proxy: env.FRONTEND_CONTRACT_HARNESS === "1" ? undefined : {
        "/api": { target: env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8000", changeOrigin: true },
      },
    },
    plugins: [
      react(),
      ...(command === "serve" && env.FRONTEND_CONTRACT_HARNESS === "1"
        ? [contractHarness(env.FRONTEND_HARNESS_FAIL_ASSET_ONCE === "1")]
        : []),
    ],
    test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"], exclude: [...configDefaults.exclude, "testing/browser/**"] },
    build: { chunkSizeWarningLimit: 1100 },
  };
});
