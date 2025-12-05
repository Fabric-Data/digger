import { AppConfig } from "../config.js";
import { SandboxRunner } from "./types.js";
import { E2BSandboxRunner } from "./e2bRunner.js";
import { DockerSandboxRunner } from "./dockerRunner.js";

export function createRunner(config: AppConfig): SandboxRunner {
  switch (config.runner) {
    case "docker":
      return new DockerSandboxRunner(config.docker);
    case "e2b":
      return new E2BSandboxRunner(config.e2b);
    default:
      throw new Error(`Unsupported runner: ${config.runner}. Use SANDBOX_RUNNER=e2b or SANDBOX_RUNNER=docker`);
  }
}

