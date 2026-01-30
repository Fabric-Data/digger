import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OpenTacoClient } from "../client.js";
import {
  downloadStateSchema,
  uploadStateSchema,
  getUnitStatusSchema,
  listVersionsSchema,
  restoreVersionSchema,
} from "../types/schemas.js";

export function registerVersionTools(server: McpServer, client: OpenTacoClient): void {
  server.tool(
    "download_state",
    "Download the current Terraform state for a unit. Returns the state as JSON.",
    downloadStateSchema.shape,
    async (args) => {
      const state = await client.downloadState(args.id);

      // Try to parse and pretty-print the state
      let formattedState: string;
      try {
        const parsed = JSON.parse(state);
        formattedState = JSON.stringify(parsed, null, 2);
      } catch {
        formattedState = state;
      }

      return {
        content: [
          {
            type: "text",
            text: `Terraform state for unit "${args.id}":\n\n\`\`\`json\n${formattedState}\n\`\`\``,
          },
        ],
      };
    }
  );

  server.tool(
    "upload_state",
    "Upload a new Terraform state to a unit. If the unit is locked, you must provide the lock_id.",
    uploadStateSchema.shape,
    async (args) => {
      // Validate that state is valid JSON
      try {
        JSON.parse(args.state);
      } catch {
        return {
          content: [
            {
              type: "text",
              text: "Error: The provided state is not valid JSON.",
            },
          ],
          isError: true,
        };
      }

      const result = await client.uploadState(args.id, args.state, args.lock_id);

      return {
        content: [
          {
            type: "text",
            text: `State uploaded successfully!\n\n${result.message}`,
          },
        ],
      };
    }
  );

  server.tool(
    "get_unit_status",
    "Get the dependency status for a unit.",
    getUnitStatusSchema.shape,
    async (args) => {
      const status = await client.getUnitStatus(args.id);

      return {
        content: [
          {
            type: "text",
            text: `Status for unit "${args.id}":\n\n\`\`\`json\n${JSON.stringify(status, null, 2)}\n\`\`\``,
          },
        ],
      };
    }
  );

  server.tool(
    "list_versions",
    "List all historical versions of a unit's Terraform state.",
    listVersionsSchema.shape,
    async (args) => {
      const result = await client.listVersions(args.id);

      if (result.versions.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No versions found for unit "${args.id}".`,
            },
          ],
        };
      }

      const versionsList = result.versions
        .map((v) => `- ${v.timestamp} (${formatBytes(v.size)}) - Hash: ${v.hash.substring(0, 8)}...`)
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: `Found ${result.count} version(s) for unit "${result.unit_id}":\n\n${versionsList}`,
          },
        ],
      };
    }
  );

  server.tool(
    "restore_version",
    "Restore a previous version of the unit's Terraform state. If the unit is locked, you must provide the lock_id.",
    restoreVersionSchema.shape,
    async (args) => {
      const result = await client.restoreVersion(args.id, args.timestamp, args.lock_id);

      return {
        content: [
          {
            type: "text",
            text: `Version restored successfully!\n\nUnit: ${result.unit_id}\nRestored to: ${result.restored_timestamp}\n${result.message}`,
          },
        ],
      };
    }
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
