import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OpenTacoClient } from "../client.js";
import { lockUnitSchema, unlockUnitSchema } from "../types/schemas.js";

export function registerLockTools(server: McpServer, client: OpenTacoClient): void {
  server.tool(
    "lock_unit",
    "Acquire a lock on a unit. This prevents other processes from modifying the state. Returns the lock ID needed for unlock.",
    lockUnitSchema.shape,
    async (args) => {
      try {
        const lockInfo = await client.lockUnit(args.id, {
          who: args.who,
          version: args.version,
        });

        return {
          content: [
            {
              type: "text",
              text: `Unit locked successfully!

Lock ID: ${lockInfo.id}
Locked by: ${lockInfo.who}
Version: ${lockInfo.version}
Created: ${lockInfo.created}

Save the Lock ID to unlock the unit later.`,
            },
          ],
        };
      } catch (error) {
        // Check if it's a lock conflict (409)
        if (error instanceof Error && error.message.includes("409")) {
          return {
            content: [
              {
                type: "text",
                text: `Lock conflict: The unit is already locked by another process.\n\nError: ${error.message}`,
              },
            ],
            isError: true,
          };
        }
        throw error;
      }
    }
  );

  server.tool(
    "unlock_unit",
    "Release a lock on a unit. You must provide the lock ID that was returned when the lock was acquired.",
    unlockUnitSchema.shape,
    async (args) => {
      try {
        await client.unlockUnit(args.id, args.lock_id);

        return {
          content: [
            {
              type: "text",
              text: `Unit "${args.id}" unlocked successfully.`,
            },
          ],
        };
      } catch (error) {
        // Check if it's a lock mismatch (409)
        if (error instanceof Error && error.message.includes("409")) {
          return {
            content: [
              {
                type: "text",
                text: `Lock mismatch: The provided lock ID does not match the current lock.\n\nError: ${error.message}`,
              },
            ],
            isError: true,
          };
        }
        throw error;
      }
    }
  );
}
