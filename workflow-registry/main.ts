import { Runner } from "@chainlink/cre-sdk";
import { configSchema, initWorkflow, type Config } from "./workflow.js";

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}
