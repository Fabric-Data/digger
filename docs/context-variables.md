# Context Variables Feature

## Overview

Context Variables provide a way to share configuration values and secrets with Digger workflow runs. They can be defined at the organization or repository level and filtered based on project name patterns or directory locations.

## Features

- **Centralized Management**: Define variables once and reuse across multiple projects
- **Secure Storage**: All values are encrypted at rest using AES-256-GCM
- **Flexible Filtering**: Apply variables to specific projects using name patterns or directory paths
- **Secret Support**: Mark variables as secrets to prevent exposure in logs and UI
- **Hierarchical Scope**: Define variables at organization level (apply to all repos) or repo level

## Use Cases

1. **Terraform Variables**: Share region configurations, provider settings, or common tfvars
2. **Module Access**: Store credentials for accessing private Terraform modules from GitHub or external registries
3. **Environment Configuration**: Share non-sensitive environment-specific settings
4. **Simplified Management**: Avoid managing dozens of GitHub secrets manually

## API Endpoints

All endpoints require authentication with organization credentials.

### List Context Variables

```http
GET /api/v1/context-variables
```

Returns all context variables for the authenticated organization.

**Response:**
```json
{
  "result": [
    {
      "id": 1,
      "name": "AWS_REGION",
      "is_secret": false,
      "value": "us-east-1",
      "repo_id": null,
      "organisation_id": 123,
      "project_name_filter": "prod-*",
      "project_directory_filter": null,
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Create Context Variable

```http
POST /api/v1/context-variables
```

**Request Body:**
```json
{
  "name": "AWS_REGION",
  "value": "us-east-1",
  "is_secret": false,
  "repo_id": null,
  "project_name_filter": "prod-*",
  "project_directory_filter": null
}
```

**Parameters:**
- `name` (required): Variable name
- `value` (required): Variable value (will be encrypted)
- `is_secret` (optional, default: false): Whether to treat as secret
- `repo_id` (optional): Restrict to specific repo, null for org-wide
- `project_name_filter` (optional): Pattern to match project names
- `project_directory_filter` (optional): Pattern to match project directories

**Response:** Returns the created variable (without value if secret)

### Get Context Variable

```http
GET /api/v1/context-variables/:variable_id
```

Returns a specific context variable by ID.

### Update Context Variable

```http
PUT /api/v1/context-variables/:variable_id
```

**Request Body:** Same as create, all fields optional

### Delete Context Variable

```http
DELETE /api/v1/context-variables/:variable_id
```

## Pattern Matching

Context variables support simple wildcard patterns for filtering:

- `*` - Matches everything
- `prefix*` - Matches names starting with "prefix"
- `*suffix` - Matches names ending with "suffix"
- `*contains*` - Matches names containing "contains"
- Exact match if no wildcards

## Examples

### Example 1: Global AWS Region

Create a variable that applies to all projects:

```json
{
  "name": "AWS_REGION",
  "value": "us-east-1",
  "is_secret": false
}
```

### Example 2: Production-Only Secret

Create a secret that only applies to production projects:

```json
{
  "name": "PROD_API_KEY",
  "value": "secret-key-value",
  "is_secret": true,
  "project_name_filter": "prod-*"
}
```

### Example 3: Repo-Specific Module Token

Create a variable for accessing private modules in a specific repo:

```json
{
  "name": "GITHUB_MODULE_TOKEN",
  "value": "ghp_xxxxxxxxxxxxx",
  "is_secret": true,
  "repo_id": 456,
  "project_directory_filter": "terraform/modules/*"
}
```

## How It Works

1. When a Digger job is triggered, the system:
   - Identifies the project's organization, repo, name, and directory
   - Queries context variables that match:
     - Organization ID
     - Repo ID (if specified, or org-wide if null)
     - Project name pattern (if specified)
     - Project directory pattern (if specified)
   
2. Matching variables are:
   - Decrypted using the `DIGGER_ENCRYPTION_SECRET`
   - Added to the workflow spec as `VariableSpec` entries
   - Passed to the workflow runner
   
3. Variables are available in the workflow as environment variables

## Security Considerations

1. **Encryption at Rest**: All values are encrypted in the database using AES-256-GCM
2. **Encryption Key**: Requires `DIGGER_ENCRYPTION_SECRET` environment variable (32-byte base64 string)
3. **Secret Marking**: Variables marked as `is_secret` are:
   - Never returned in API responses
   - Should be treated as sensitive in logs
4. **Access Control**: Variables are scoped to organizations; users can only access variables for their org

## Configuration

### Required Environment Variable

```bash
DIGGER_ENCRYPTION_SECRET=<32-byte-base64-encoded-key>
```

Generate a key:
```bash
openssl rand -base64 32
```

## Database Schema

```sql
CREATE TABLE context_variables (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  name TEXT NOT NULL,
  value_encrypted TEXT,
  is_secret BOOLEAN NOT NULL DEFAULT false,
  repo_id BIGINT REFERENCES repos(id) ON DELETE CASCADE,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_name_filter TEXT,
  project_directory_filter TEXT
);
```

## Migration

The feature requires running migration `20251201000000.sql` to create the `context_variables` table.

## Future Enhancements

Potential improvements for future versions:

1. **Regex Support**: Full regular expression support for pattern matching
2. **Variable Sets**: Group related variables into sets
3. **Variable Precedence**: Define explicit precedence rules when multiple variables match
4. **Audit Logging**: Track variable access and modifications
5. **UI Integration**: Web interface for managing variables
6. **Import/Export**: Bulk import/export of variables
7. **Variable Validation**: Schema validation for variable values
8. **Version History**: Track changes to variable values over time
