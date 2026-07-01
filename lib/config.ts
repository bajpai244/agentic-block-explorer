import { z } from "zod";

const serverConfigSchema = z.object({
  GOLDRUSH_API_KEY: z.string().min(1, "GOLDRUSH_API_KEY is required"),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  OPENROUTER_MODEL: z.string().default("openai/gpt-5.2"),
  OPENROUTER_SITE_URL: z.string().default("http://localhost:3000"),
  OPENROUTER_APP_NAME: z.string().default("chacha"),
  DATABASE_URL: z.string().min(1),
  ETHEREUM_CHAIN_NAME: z.string().default("eth-mainnet"),
  PEPE_TOKEN_ADDRESS: z.string().default("0x6982508145454ce325ddbe47a25d4ec3d2311933"),
});

export function getServerConfig() {
  return serverConfigSchema.parse(process.env);
}

export const publicConfig = {
  appName: process.env.NEXT_PUBLIC_APP_NAME || "chacha",
};
