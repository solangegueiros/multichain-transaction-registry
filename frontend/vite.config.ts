import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import productionWorkflow from "../workflow-registry/config/config.production.json";
import stagingWorkflow from "../workflow-registry/config/config.staging.json";

// The mode is the environment: --mode staging or --mode production (see package.json).
// Each environment builds to its own folder, dist/<environment>.
export default defineConfig(({ mode }) => {
  const environment = mode === "production" ? "production" : "staging";
  const workflowConfig = environment === "production" ? productionWorkflow : stagingWorkflow;

  // The Observer API does not accept its own headers in a browser preflight (CORS), so
  // the pages reach it through this proxy, in `vite` and in `vite preview` alike.
  const api = new URL(workflowConfig.apiBaseUrl);
  const observerProxy = {
    "/observer-api": {
      target: api.origin,
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/observer-api/, api.pathname),
    },
  };

  return {
    plugins: [react()],
    resolve: {
      // The pages import code of ../workflow-registry/lib: it must use the viem installed here
      alias: { viem: fileURLToPath(new URL("./node_modules/viem", import.meta.url)) },
    },
    server: {
      port: 5173,
      proxy: observerProxy,
      // project.config.<environment>.json and workflow-registry/ live outside this folder
      fs: { allow: [".."] },
    },
    build: { outDir: `dist/${environment}` },
    preview: { port: 4173, proxy: observerProxy },
  };
});
