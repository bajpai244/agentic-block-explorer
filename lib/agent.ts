import OpenAI from "openai";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { getServerConfig } from "@/lib/config";
import {
  getPepeHolderBalance,
  getPepeHolderHistory,
  getPepeTransfers,
  getTopPepeHolders,
  getWalletPortfolio,
} from "@/lib/goldrush";
import { prisma } from "@/lib/prisma";
import type { ChatBlock, ChatResponse, SourceMeta } from "@/lib/types";

const addressPattern = /0x[a-fA-F0-9]{40}/;

const chatInputSchema = z.object({
  sessionId: z.string().optional(),
  message: z.string().min(1).max(2000),
});

export type ChatInput = z.infer<typeof chatInputSchema>;

function getOpenRouterClient() {
  const config = getServerConfig();
  if (!config.OPENROUTER_API_KEY) return null;
  return new OpenAI({
    apiKey: config.OPENROUTER_API_KEY,
    baseURL: config.OPENROUTER_BASE_URL,
    defaultHeaders: {
      "HTTP-Referer": config.OPENROUTER_SITE_URL,
      "X-OpenRouter-Title": config.OPENROUTER_APP_NAME,
    },
  });
}

function holderTable(rows: Awaited<ReturnType<typeof getTopPepeHolders>>["rows"], source: SourceMeta): ChatBlock {
  return {
    type: "table",
    title: "Top PEPE holders",
    columns: [
      { key: "rank", label: "Rank" },
      { key: "address", label: "Address" },
      { key: "formattedBalance", label: "PEPE" },
      { key: "share", label: "Supply %" },
    ],
    rows: rows.map((row) => ({
      rank: row.rank,
      address: row.address,
      formattedBalance: row.formattedBalance,
      share: row.share == null ? null : row.share.toFixed(4),
    })),
    source,
  };
}

function historyChart(address: string, data: Awaited<ReturnType<typeof getPepeHolderHistory>>, source: SourceMeta): ChatBlock {
  return {
    type: "chart",
    title: `PEPE balance history for ${address.slice(0, 6)}...${address.slice(-4)}`,
    xKey: "date",
    yKeys: ["balance"],
    data: data.data,
    source,
  };
}

async function runTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "getTopPepeHolders":
      return getTopPepeHolders(Number(args.limit || 20));
    case "getPepeHolderBalance":
      return getPepeHolderBalance(String(args.address || ""));
    case "getWalletPortfolio":
      return getWalletPortfolio(String(args.address || ""), Number(args.days || 30));
    case "getPepeHolderHistory":
      return getPepeHolderHistory(String(args.address || ""), Number(args.days || 30));
    case "getPepeTransfers":
      return getPepeTransfers(String(args.address || ""), Number(args.limit || 10));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function pickHeuristicTool(message: string): { name: string; args: Record<string, unknown> } {
  const lower = message.toLowerCase();
  const address = message.match(addressPattern)?.[0];
  const limit = Number(message.match(/top\s+(\d+)/i)?.[1] || 20);
  const days = Number(message.match(/(\d+)\s+days?/i)?.[1] || 30);

  if (lower.includes("portfolio") && address) {
    return { name: "getWalletPortfolio", args: { address, days } };
  }
  if ((lower.includes("chart") || lower.includes("history") || lower.includes("over time")) && address) {
    return { name: "getPepeHolderHistory", args: { address, days } };
  }
  if ((lower.includes("transfer") || lower.includes("bought") || lower.includes("sold")) && address) {
    return { name: "getPepeTransfers", args: { address, limit: 10 } };
  }
  if (address) {
    return { name: "getPepeHolderBalance", args: { address } };
  }
  return { name: "getTopPepeHolders", args: { limit: Math.min(Math.max(limit, 1), 50) } };
}

async function createAnswerWithOpenRouter(message: string, toolName: string, toolResult: unknown) {
  const client = getOpenRouterClient();
  const config = getServerConfig();
  if (!client) return null;

  try {
    const completion = await client.chat.completions.create({
      model: config.OPENROUTER_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are chacha, an AI-native Ethereum explorer for PEPE. Answer concisely from the provided tool result. Mention when data comes from cached GoldRush results. Do not claim support for non-PEPE tokens in this MVP.",
        },
        { role: "user", content: message },
        { role: "user", content: `Tool result JSON:\n${JSON.stringify({ toolName, toolResult }).slice(0, 30000)}` },
      ],
    });
    return completion.choices[0]?.message?.content || null;
  } catch {
    return null;
  }
}

function fallbackAnswer(toolName: string, toolResult: unknown) {
  if (toolName === "getTopPepeHolders") {
    const result = toolResult as Awaited<ReturnType<typeof getTopPepeHolders>>;
    const leader = result.rows[0];
    return leader
      ? `The largest indexed PEPE holder in this snapshot is ${leader.address}, with about ${leader.formattedBalance} PEPE.`
      : "I could not find holder rows in the current GoldRush response.";
  }
  if (toolName === "getPepeHolderHistory") {
    const result = toolResult as Awaited<ReturnType<typeof getPepeHolderHistory>>;
    return result.data.length
      ? `I found ${result.data.length} PEPE balance points for this wallet and charted them below.`
      : "I could not find PEPE holding history for that wallet in the selected window.";
  }
  if (toolName === "getWalletPortfolio") {
    const result = toolResult as Awaited<ReturnType<typeof getWalletPortfolio>>;
    return `This wallet portfolio response includes ${result.items.length} token positions from GoldRush.`;
  }
  if (toolName === "getPepeHolderBalance") {
    const result = toolResult as Awaited<ReturnType<typeof getPepeHolderBalance>>;
    return result.row
      ? `That wallet appears in the fetched holder page at rank ${result.row.rank}, with about ${result.row.formattedBalance} PEPE.`
      : "That wallet was not found in the fetched top-holder page. For the MVP, deeper holder lookup can require a larger paginated scan.";
  }
  return "I fetched the relevant PEPE data from GoldRush.";
}

function blocksFor(toolName: string, args: Record<string, unknown>, toolResult: unknown): ChatBlock[] {
  if (toolName === "getTopPepeHolders") {
    const result = toolResult as Awaited<ReturnType<typeof getTopPepeHolders>>;
    return [holderTable(result.rows, result.source)];
  }
  if (toolName === "getPepeHolderHistory") {
    const result = toolResult as Awaited<ReturnType<typeof getPepeHolderHistory>>;
    return [historyChart(String(args.address), result, result.source)];
  }
  if (toolName === "getWalletPortfolio") {
    const result = toolResult as Awaited<ReturnType<typeof getWalletPortfolio>>;
    return [
      {
        type: "table",
        title: "Wallet portfolio",
        columns: [
          { key: "symbol", label: "Token" },
          { key: "name", label: "Name" },
          { key: "contract", label: "Contract" },
        ],
        rows: result.items.slice(0, 25).map((item) => ({
          symbol: item.contract_ticker_symbol || "",
          name: item.contract_name || "",
          contract: item.contract_address || "",
        })),
        source: result.source,
      },
    ];
  }
  return [];
}

function rejectUnsupportedToken(message: string) {
  const lower = message.toLowerCase();
  const mentionsOtherToken = /\$?(shib|uni|link|weth|usdc|usdt|dai|ape|bonk)\b/.test(lower);
  return mentionsOtherToken && !lower.includes("pepe");
}

export async function handleChat(input: unknown): Promise<ChatResponse> {
  const parsed = chatInputSchema.parse(input);
  const session =
    parsed.sessionId != null
      ? await prisma.chatSession.upsert({
          where: { id: parsed.sessionId },
          create: { id: parsed.sessionId },
          update: {},
        })
      : await prisma.chatSession.create({ data: {} });

  await prisma.chatMessage.create({
    data: { sessionId: session.id, role: "user", content: parsed.message },
  });

  if (rejectUnsupportedToken(parsed.message)) {
    const answer = "chacha is PEPE-only in this MVP. Ask me about PEPE holders, PEPE wallet balances, or PEPE holder charts.";
    await prisma.chatMessage.create({ data: { sessionId: session.id, role: "assistant", content: answer } });
    return { sessionId: session.id, answer, blocks: [], toolCalls: [] };
  }

  const toolCall = pickHeuristicTool(parsed.message);
  const result = await runTool(toolCall.name, toolCall.args);

  await prisma.toolCallResult.create({
    data: {
      sessionId: session.id,
      toolName: toolCall.name,
      args: toolCall.args as Prisma.InputJsonValue,
      result: result as Prisma.InputJsonValue,
    },
  });

  const answer = (await createAnswerWithOpenRouter(parsed.message, toolCall.name, result)) || fallbackAnswer(toolCall.name, result);
  const blocks = blocksFor(toolCall.name, toolCall.args, result);

  await prisma.chatMessage.create({
    data: {
      sessionId: session.id,
      role: "assistant",
      content: answer,
      blocks: blocks as Prisma.InputJsonValue,
    },
  });

  return {
    sessionId: session.id,
    answer,
    blocks,
    toolCalls: [toolCall],
  };
}
