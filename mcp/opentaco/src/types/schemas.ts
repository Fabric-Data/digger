import { z } from "zod";

// Unit-related schemas
export const createUnitSchema = z.object({
  name: z.string().min(1).describe("Name for the new unit"),
  tfe_auto_apply: z.boolean().optional().describe("Auto-apply changes (TFE setting)"),
  tfe_execution_mode: z.string().optional().describe("Execution mode (TFE setting)"),
  tfe_terraform_version: z.string().optional().describe("Terraform version (TFE setting)"),
  tfe_engine: z.string().optional().describe("Engine type: terraform or tofu (TFE setting)"),
  tfe_working_directory: z.string().optional().describe("Working directory (TFE setting)"),
});

export const updateUnitSchema = z.object({
  id: z.string().min(1).describe("Unit ID (UUID or name)"),
  tfe_auto_apply: z.boolean().optional().describe("Auto-apply changes (TFE setting)"),
  tfe_execution_mode: z.string().optional().describe("Execution mode (TFE setting)"),
  tfe_terraform_version: z.string().optional().describe("Terraform version (TFE setting)"),
  tfe_engine: z.string().optional().describe("Engine type: terraform or tofu (TFE setting)"),
  tfe_working_directory: z.string().optional().describe("Working directory (TFE setting)"),
});

export const listUnitsSchema = z.object({
  prefix: z.string().optional().describe("Optional prefix to filter units by name"),
});

export const getUnitSchema = z.object({
  id: z.string().min(1).describe("Unit ID (UUID or name)"),
});

export const deleteUnitSchema = z.object({
  id: z.string().min(1).describe("Unit ID (UUID or name)"),
});

// State-related schemas
export const downloadStateSchema = z.object({
  id: z.string().min(1).describe("Unit ID (UUID or name)"),
});

export const uploadStateSchema = z.object({
  id: z.string().min(1).describe("Unit ID (UUID or name)"),
  state: z.string().min(1).describe("Terraform state as JSON string"),
  lock_id: z.string().optional().describe("Lock ID if unit is locked"),
});

export const getUnitStatusSchema = z.object({
  id: z.string().min(1).describe("Unit ID (UUID or name)"),
});

// Lock-related schemas
export const lockUnitSchema = z.object({
  id: z.string().min(1).describe("Unit ID (UUID or name)"),
  who: z.string().optional().describe("Who is acquiring the lock (defaults to 'opentaco')"),
  version: z.string().optional().describe("Version string (defaults to '1.0.0')"),
});

export const unlockUnitSchema = z.object({
  id: z.string().min(1).describe("Unit ID (UUID or name)"),
  lock_id: z.string().min(1).describe("Lock ID to release"),
});

// Version-related schemas
export const listVersionsSchema = z.object({
  id: z.string().min(1).describe("Unit ID (UUID or name)"),
});

export const restoreVersionSchema = z.object({
  id: z.string().min(1).describe("Unit ID (UUID or name)"),
  timestamp: z.string().min(1).describe("ISO8601 timestamp of the version to restore"),
  lock_id: z.string().optional().describe("Lock ID if unit is locked"),
});

// Response types
export interface LockInfo {
  id: string;
  who: string;
  version: string;
  created: string;
}

export interface Unit {
  id: string;
  name: string;
  absolute_name: string;
  size: number;
  updated: string;
  locked: boolean;
  lock_info?: LockInfo;
  tfe_auto_apply?: boolean;
  tfe_terraform_version?: string;
  tfe_engine?: string;
  tfe_working_directory?: string;
  tfe_execution_mode?: string;
}

export interface ListUnitsResponse {
  units: Unit[];
  count: number;
}

export interface CreateUnitResponse {
  id: string;
  created: string;
}

export interface UpdateUnitResponse {
  id: string;
  message: string;
}

export interface UploadStateResponse {
  message: string;
}

export interface Version {
  timestamp: string;
  hash: string;
  size: number;
}

export interface ListVersionsResponse {
  unit_id: string;
  versions: Version[];
  count: number;
}

export interface RestoreVersionResponse {
  unit_id: string;
  restored_timestamp: string;
  message: string;
}

export interface ApiError {
  error: string;
  detail?: string;
}
