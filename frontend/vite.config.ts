import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import productionWorkflow from "../workflow-registry/config/config.production.json";
import stagingWorkflow from "../workflow-registry/config/config.staging.json";

// The Observer API does not accept its own headers in a browser preflight (CORS), so
// the pages reach it through a proxy, in `vite` and in `vite preview` alike. There is one
// per environment, each with the API of the workflow of that environment.
const proxyTo = (apiBaseUrl: string, prefix: string) => {
  const api = new URL(apiBaseUrl);
  return {
    target: api.origin,
    changeOrigin: true,
    rewrite: (path: string) => api.pathname + path.slice(prefix.length),
  };
};
const observerProxy = {
  "/observer-api/staging": proxyTo(stagingWorkflow.apiBaseUrl, "/observer-api/staging"),
  "/observer-api/production": proxyTo(productionWorkflow.apiBaseUrl, "/observer-api/production"),
};

export default defineConfig({
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
  preview: { port: 4173, proxy: observerProxy },
});
