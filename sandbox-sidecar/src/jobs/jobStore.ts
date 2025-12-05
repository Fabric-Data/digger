import { nanoid } from "nanoid";
import {
  JobStatus,
  SandboxRunPayload,
  SandboxRunRecord,
  SandboxRunResult,
} from "./jobTypes.js";

/**
 * Efficient log buffer that avoids O(n²) string concatenation.
 * Uses array of chunks + lazy join for O(n) total complexity.
 */
class LogBuffer {
  private chunks: string[] = [];
  private cachedResult: string | null = null;

  append(chunk: string) {
    if (!chunk) return;
    this.chunks.push(chunk);
    this.cachedResult = null; // Invalidate cache
  }

  toString(): string {
    if (this.cachedResult === null) {
      this.cachedResult = this.chunks.join("");
    }
    return this.cachedResult;
  }

  set(logs: string) {
    this.chunks = [logs];
    this.cachedResult = logs;
  }
}

export class JobStore {
  private jobs = new Map<string, SandboxRunRecord>();
  private logBuffers = new Map<string, LogBuffer>();

  create(payload: SandboxRunPayload): SandboxRunRecord {
    const id = `sbx_run_${nanoid(10)}`;
    const now = new Date();
    const job: SandboxRunRecord = {
      id,
      payload,
      status: "pending",
      logs: "",
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(id, job);
    this.logBuffers.set(id, new LogBuffer());
    return job;
  }

  get(id: string): SandboxRunRecord | undefined {
    const job = this.jobs.get(id);
    if (job) {
      // Lazily materialize logs from buffer
      const buffer = this.logBuffers.get(id);
      if (buffer) {
        job.logs = buffer.toString();
      }
    }
    return job;
  }

  updateStatus(id: string, status: JobStatus, logs?: string, error?: string) {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = status;
    if (typeof logs === "string") {
      const buffer = this.logBuffers.get(id);
      if (buffer) {
        buffer.set(logs);
      }
      job.logs = logs;
    }
    job.error = error;
    job.updatedAt = new Date();
  }

  appendLogs(id: string, chunk: string) {
    const buffer = this.logBuffers.get(id);
    if (!buffer || !chunk) return;
    buffer.append(chunk);
    // Note: We don't update job.logs here - it's materialized lazily in get()
    // This avoids O(n²) string concatenation!
    const job = this.jobs.get(id);
    if (job) {
      job.updatedAt = new Date();
    }
  }

  setResult(id: string, result: SandboxRunResult | undefined) {
    const job = this.jobs.get(id);
    if (!job) return;
    job.result = result;
    job.updatedAt = new Date();
  }

  // Clean up buffer when job is done (optional memory optimization)
  finalize(id: string) {
    const job = this.jobs.get(id);
    const buffer = this.logBuffers.get(id);
    if (job && buffer) {
      job.logs = buffer.toString();
    }
    // Keep buffer for now in case logs are requested again
  }
}
