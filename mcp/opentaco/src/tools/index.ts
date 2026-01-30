import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OpenTacoClient } from "../client.js";
import { registerUnitTools } from "./units.js";
import { registerVersionTools } from "./versions.js";
import { registerLockTools } from "./locks.js";

export function registerAllTools(server: McpServer, client: OpenTacoClient): void {
  registerUnitTools(server, client);
  registerVersionTools(server, client);
  registerLockTools(server, client);
}
