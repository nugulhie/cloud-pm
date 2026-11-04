import { Users } from "../users/service";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server";
import { Service } from "../core/service";
import { getStore } from "../db/store";
// stdio 접근은 프로세스를 실행할 수 있는 로컬 사용자에게 허용한다.
const store = getStore();
const actor = process.env.MCP_ACCESS_TOKEN
  ? (
      await new Users(store).resolve(
        new Request("http://localhost/mcp", {
          headers: { authorization: `Bearer ${process.env.MCP_ACCESS_TOKEN}` },
        }),
      )
    ).actor
  : {
      name: "local-mcp",
      role:
        process.env.MCP_READ_ONLY === "true"
          ? ("read" as const)
          : ("write" as const),
    };
const service = new Service(store, actor);
const guarded = process.env.MCP_ACCESS_TOKEN
  ? new Proxy(service, {
      get(target, key) {
        const value = Reflect.get(target, key);
        if (typeof value === "function")
          return async (...args: unknown[]) => {
            target.actor = (
              await new Users(store).resolve(
                new Request("http://localhost/mcp", {
                  headers: {
                    authorization: `Bearer ${process.env.MCP_ACCESS_TOKEN}`,
                  },
                }),
              )
            ).actor;
            return Reflect.apply(value, target, args);
          };
        return value;
      },
    })
  : service;
const server = createMcpServer(guarded);
await server.connect(new StdioServerTransport());
async function close() {
  await server.close();
  await store.close();
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
