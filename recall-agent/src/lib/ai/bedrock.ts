import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

const globalForBedrock = globalThis as unknown as {
  recallBedrock?: BedrockRuntimeClient;
};

export function getBedrockClient(): BedrockRuntimeClient {
  if (!globalForBedrock.recallBedrock) {
    globalForBedrock.recallBedrock = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || "us-east-1",
      maxAttempts: 3,
    });
  }
  return globalForBedrock.recallBedrock;
}
