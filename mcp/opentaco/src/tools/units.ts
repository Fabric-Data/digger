import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OpenTacoClient } from "../client.js";
import {
  listUnitsSchema,
  getUnitSchema,
  createUnitSchema,
  deleteUnitSchema,
  updateUnitSchema,
} from "../types/schemas.js";

export function registerUnitTools(server: McpServer, client: OpenTacoClient): void {
  server.tool(
    "list_units",
    "List all units in the organization. Units represent Terraform state storage containers.",
    listUnitsSchema.shape,
    async (args) => {
      const result = await client.listUnits(args.prefix);

      if (result.units.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No units found" + (args.prefix ? ` with prefix "${args.prefix}"` : ""),
            },
          ],
        };
      }

      const unitsList = result.units
        .map((u) => {
          const status = u.locked ? `[LOCKED by ${u.lock_info?.who || "unknown"}]` : "[unlocked]";
          const size = formatBytes(u.size);
          return `- ${u.name} (${u.id}) ${status} - ${size}`;
        })
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: `Found ${result.count} unit(s):\n\n${unitsList}`,
          },
        ],
      };
    }
  );

  server.tool(
    "get_unit",
    "Get detailed information about a specific unit including its lock status and TFE settings.",
    getUnitSchema.shape,
    async (args) => {
      const unit = await client.getUnit(args.id);

      const lockInfo = unit.locked && unit.lock_info
        ? `Locked by: ${unit.lock_info.who}\nLock ID: ${unit.lock_info.id}\nLock Version: ${unit.lock_info.version}\nLocked at: ${unit.lock_info.created}`
        : "Not locked";

      const tfeSettings = [
        unit.tfe_auto_apply !== undefined ? `Auto Apply: ${unit.tfe_auto_apply}` : null,
        unit.tfe_execution_mode ? `Execution Mode: ${unit.tfe_execution_mode}` : null,
        unit.tfe_terraform_version ? `Terraform Version: ${unit.tfe_terraform_version}` : null,
        unit.tfe_engine ? `Engine: ${unit.tfe_engine}` : null,
        unit.tfe_working_directory ? `Working Directory: ${unit.tfe_working_directory}` : null,
      ].filter(Boolean).join("\n");

      return {
        content: [
          {
            type: "text",
            text: `Unit: ${unit.name}
ID: ${unit.id}
Full Name: ${unit.absolute_name}
Size: ${formatBytes(unit.size)}
Last Updated: ${unit.updated}

Lock Status:
${lockInfo}

TFE Settings:
${tfeSettings || "None configured"}`,
          },
        ],
      };
    }
  );

  server.tool(
    "create_unit",
    "Create a new unit for storing Terraform state. Units can have optional TFE-compatible settings.",
    createUnitSchema.shape,
    async (args) => {
      const { name, ...settings } = args;
      const result = await client.createUnit(name, settings);

      return {
        content: [
          {
            type: "text",
            text: `Unit created successfully!\n\nID: ${result.id}\nCreated: ${result.created}`,
          },
        ],
      };
    }
  );

  server.tool(
    "update_unit",
    "Update TFE settings for an existing unit.",
    updateUnitSchema.shape,
    async (args) => {
      const { id, ...settings } = args;
      const result = await client.updateUnit(id, settings);

      return {
        content: [
          {
            type: "text",
            text: `Unit updated successfully!\n\nID: ${result.id}\n${result.message}`,
          },
        ],
      };
    }
  );

  server.tool(
    "delete_unit",
    "Delete a unit and its associated state. This action is irreversible.",
    deleteUnitSchema.shape,
    async (args) => {
      await client.deleteUnit(args.id);

      return {
        content: [
          {
            type: "text",
            text: `Unit "${args.id}" deleted successfully.`,
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
