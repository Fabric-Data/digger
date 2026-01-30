# OpenTaco MCP Server

An MCP (Model Context Protocol) server that exposes the OpenTaco unit management API as tools for AI assistants.

## Features

This server provides tools for managing Terraform state units in OpenTaco:

### Unit Operations
- `list_units` - List all units in the organization
- `get_unit` - Get details of a specific unit
- `create_unit` - Create a new unit
- `update_unit` - Update unit TFE settings
- `delete_unit` - Delete a unit

### State Operations
- `download_state` - Download a unit's Terraform state
- `upload_state` - Upload new state to a unit
- `get_unit_status` - Get dependency status for a unit

### Lock Operations
- `lock_unit` - Acquire a lock on a unit
- `unlock_unit` - Release a lock on a unit

### Version Operations
- `list_versions` - List historical state versions
- `restore_version` - Restore a previous version

## Installation

```bash
cd mcp/opentaco
npm install
npm run build
```

## Configuration

The server requires two environment variables:

- `OPENTACO_API_URL` - Your OpenTaco server URL (e.g., `https://opentaco.example.com`)
- `OPENTACO_API_TOKEN` - Your OpenTaco API token (JWT)

## Usage with Claude Desktop

Add this configuration to your Claude Desktop config file:

### macOS
`~/Library/Application Support/Claude/claude_desktop_config.json`

### Windows
`%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "opentaco": {
      "command": "node",
      "args": ["/path/to/mcp/opentaco/dist/index.js"],
      "env": {
        "OPENTACO_API_URL": "https://opentaco.example.com",
        "OPENTACO_API_TOKEN": "your-jwt-token"
      }
    }
  }
}
```

## Development

```bash
# Run in development mode with hot reload
npm run dev

# Build for production
npm run build

# Run production build
npm start
```

## Example Tool Usage

Once configured, you can ask Claude to:

- "List all my Terraform units"
- "Show me details for unit my-project-prod"
- "Create a new unit called my-new-project"
- "Download the state for unit my-project-dev"
- "Lock the unit my-project-staging"
- "Show me the version history for unit my-project-prod"
- "Restore unit my-project-dev to the version from yesterday"

## API Reference

This server wraps the OpenTaco Management API (`/v1/units/*`). For full API documentation, see the OpenTaco documentation.

## License

See the main repository license.
