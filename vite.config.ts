import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { createRuntime } from "./server/runtime.ts";
import { isRuntimeRequestPath } from "./server/request-routing.ts";
export default defineConfig({
  plugins: [react(), {
    name: "wiki-server",
    async configureServer(server) {
      const runtime = await createRuntime();
      server.httpServer?.once("close", async () => { await runtime.close(); });
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url || "/", "http://localhost").pathname;
        if (!isRuntimeRequestPath(pathname)) return next();
        void runtime.middleware(request, response);
      });
    },
  }],
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
