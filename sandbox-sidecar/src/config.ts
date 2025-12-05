import dotenv from "dotenv";

dotenv.config();

export type RunnerType = "e2b" | "docker";

export interface AppConfig {
  port: number;
  runner: RunnerType;
  e2b: {
    apiKey?: string;
    bareBonesTemplateId?: string; // Base template for custom versions
  };
  docker: {
    image?: string; // Custom Docker image (default: hashicorp/terraform:<version>)
    terraformVersion?: string; // Default TF version if not specified in job
  };
}

const parsePort = (value: string | undefined, fallback: number) => {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

export function loadConfig(): AppConfig {
  const runnerEnv = (process.env.SANDBOX_RUNNER || "e2b").toLowerCase();
  
  if (runnerEnv !== "e2b" && runnerEnv !== "docker") {
    throw new Error("Unsupported runner. Set SANDBOX_RUNNER=e2b or SANDBOX_RUNNER=docker");
  }

  return {
    port: parsePort(process.env.PORT, 9100),
    runner: runnerEnv as RunnerType,
    e2b: {
      apiKey: process.env.E2B_API_KEY,
      bareBonesTemplateId: process.env.E2B_BAREBONES_TEMPLATE_ID,
    },
    docker: {
      image: process.env.DOCKER_TERRAFORM_IMAGE,
      terraformVersion: process.env.DOCKER_TERRAFORM_VERSION || "1.5.7",
    },
  };
}

