export interface OpenTacoConfig {
  apiUrl: string;
  apiToken: string;
}

export function loadConfig(): OpenTacoConfig {
  const apiUrl = process.env.OPENTACO_API_URL;
  const apiToken = process.env.OPENTACO_API_TOKEN;

  if (!apiUrl) {
    throw new Error(
      "OPENTACO_API_URL environment variable is required. " +
        "Set it to your OpenTaco server URL (e.g., https://opentaco.example.com)"
    );
  }

  if (!apiToken) {
    throw new Error(
      "OPENTACO_API_TOKEN environment variable is required. " +
        "Set it to your OpenTaco API token (JWT)"
    );
  }

  // Remove trailing slash if present
  const normalizedUrl = apiUrl.replace(/\/+$/, "");

  return {
    apiUrl: normalizedUrl,
    apiToken,
  };
}
