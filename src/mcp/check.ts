import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
export function checkUrl(value: string) {
  const url = new URL(value);
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "연결 주소는 HTTPS 또는 로컬 HTTP MCP URL이어야 하며 자격 증명·쿼리를 포함할 수 없습니다.",
    );
  return url;
}
export async function checkMcpConnection(
  value: string,
  token: string,
  fetcher: typeof fetch = fetch,
) {
  const url = checkUrl(value);
  if (!token.trim())
    throw new Error("MCP_ACCESS_TOKEN에 개인 서비스 토큰을 설정하세요.");
  const client = new Client({ name: "cloud-pm-cli-check", version: "1" });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${token.trim()}` } },
    fetch: (input, init) => fetcher(input, { ...init, redirect: "error" }),
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    return {
      server: client.getServerVersion()?.name,
      tools: tools.tools.length,
      writeSupported: tools.tools.some((tool) => tool.name === "create_task"),
    };
  } catch {
    throw new Error(
      "MCP 연결 점검에 실패했습니다. 주소·개인 토큰·접근 권한을 확인하세요.",
    );
  } finally {
    await client.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const url =
      process.env.MCP_SERVER_URL ??
      `${new URL(process.env.APP_URL ?? "http://127.0.0.1:3000").origin}/api/mcp`;
    console.log(
      JSON.stringify(
        await checkMcpConnection(url, process.env.MCP_ACCESS_TOKEN ?? ""),
      ),
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "MCP 연결 점검 실패",
    );
    process.exitCode = 1;
  }
}
