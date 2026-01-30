import type { OpenTacoConfig } from "./config.js";
import type {
  Unit,
  ListUnitsResponse,
  CreateUnitResponse,
  UpdateUnitResponse,
  UploadStateResponse,
  LockInfo,
  ListVersionsResponse,
  RestoreVersionResponse,
  ApiError,
} from "./types/schemas.js";

export class OpenTacoClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(config: OpenTacoConfig) {
    this.baseUrl = config.apiUrl;
    this.token = config.apiToken;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    isRawResponse = false
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
    };

    if (body && typeof body === "string") {
      headers["Content-Type"] = "application/octet-stream";
    } else if (body) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body
        ? typeof body === "string"
          ? body
          : JSON.stringify(body)
        : undefined,
    });

    if (!response.ok) {
      let errorMessage: string;
      try {
        const errorBody = (await response.json()) as ApiError;
        errorMessage = errorBody.error || errorBody.detail || response.statusText;
      } catch {
        errorMessage = response.statusText;
      }
      throw new Error(`OpenTaco API error (${response.status}): ${errorMessage}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    if (isRawResponse) {
      return (await response.text()) as T;
    }

    return response.json() as Promise<T>;
  }

  private encodeUnitId(id: string): string {
    // URL-encode the ID to handle special characters like slashes
    return encodeURIComponent(id);
  }

  // Unit CRUD operations
  async listUnits(prefix?: string): Promise<ListUnitsResponse> {
    const params = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
    return this.request<ListUnitsResponse>("GET", `/v1/units${params}`);
  }

  async getUnit(id: string): Promise<Unit> {
    return this.request<Unit>("GET", `/v1/units/${this.encodeUnitId(id)}`);
  }

  async createUnit(
    name: string,
    settings?: {
      tfe_auto_apply?: boolean;
      tfe_execution_mode?: string;
      tfe_terraform_version?: string;
      tfe_engine?: string;
      tfe_working_directory?: string;
    }
  ): Promise<CreateUnitResponse> {
    return this.request<CreateUnitResponse>("POST", "/v1/units", {
      name,
      ...settings,
    });
  }

  async updateUnit(
    id: string,
    settings: {
      tfe_auto_apply?: boolean;
      tfe_execution_mode?: string;
      tfe_terraform_version?: string;
      tfe_engine?: string;
      tfe_working_directory?: string;
    }
  ): Promise<UpdateUnitResponse> {
    return this.request<UpdateUnitResponse>(
      "PATCH",
      `/v1/units/${this.encodeUnitId(id)}`,
      settings
    );
  }

  async deleteUnit(id: string): Promise<void> {
    await this.request<void>("DELETE", `/v1/units/${this.encodeUnitId(id)}`);
  }

  // State operations
  async downloadState(id: string): Promise<string> {
    return this.request<string>(
      "GET",
      `/v1/units/${this.encodeUnitId(id)}/download`,
      undefined,
      true
    );
  }

  async uploadState(
    id: string,
    state: string,
    lockId?: string
  ): Promise<UploadStateResponse> {
    const params = lockId ? `?if_locked_by=${encodeURIComponent(lockId)}` : "";
    return this.request<UploadStateResponse>(
      "POST",
      `/v1/units/${this.encodeUnitId(id)}/upload${params}`,
      state
    );
  }

  async getUnitStatus(id: string): Promise<unknown> {
    return this.request<unknown>(
      "GET",
      `/v1/units/${this.encodeUnitId(id)}/status`
    );
  }

  // Lock operations
  async lockUnit(
    id: string,
    info?: { who?: string; version?: string }
  ): Promise<LockInfo> {
    return this.request<LockInfo>(
      "POST",
      `/v1/units/${this.encodeUnitId(id)}/lock`,
      {
        who: info?.who || "opentaco",
        version: info?.version || "1.0.0",
      }
    );
  }

  async unlockUnit(id: string, lockId: string): Promise<void> {
    await this.request<void>(
      "DELETE",
      `/v1/units/${this.encodeUnitId(id)}/unlock`,
      { id: lockId }
    );
  }

  // Version operations
  async listVersions(id: string): Promise<ListVersionsResponse> {
    return this.request<ListVersionsResponse>(
      "GET",
      `/v1/units/${this.encodeUnitId(id)}/versions`
    );
  }

  async restoreVersion(
    id: string,
    timestamp: string,
    lockId?: string
  ): Promise<RestoreVersionResponse> {
    return this.request<RestoreVersionResponse>(
      "POST",
      `/v1/units/${this.encodeUnitId(id)}/restore`,
      {
        timestamp,
        lock_id: lockId,
      }
    );
  }
}
