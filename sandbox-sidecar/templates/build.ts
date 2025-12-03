// build.ts
import { Template, defaultBuildLogger } from "e2b";
import { template } from "./test-template.ts";

async function main() {
  const buildInfo = await Template.build(template, {
    alias: "terraform-prebuilt-new",           // template name / alias
    cpuCount: 8,      // Max for Pro tier
    memoryMB: 8192,   // 8GB - Max for Pro tier
    onBuildLogs: defaultBuildLogger(),
  });

  console.log("Template built:");
  console.log("Template ID:", buildInfo.templateId);
  console.log("Build ID:", buildInfo.buildId);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
