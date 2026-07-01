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

type TopPepeHolderHistoryResult = {
  holder: Awaited<ReturnType<typeof getTopPepeHolders>>["rows"][number] | null;
  holderSource: SourceMeta;
  history: Awaited<ReturnType<typeof getPepeHolderHistory>> | null;
};

type PepeHolderHistoryResult = Awaited<ReturnType<typeof getPepeHolderHistory>> & {
  requestedDays?: number;
  servedDays?: number;
  warning?: string;
};

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
    chartType: "line",
    title: `PEPE balance history for ${address.slice(0, 6)}...${address.slice(-4)}`,
    xKey: "date",
    yKeys: ["balance"],
    data: data.data,
    source,
  };
}

function holderSupplyPie(rows: Awaited<ReturnType<typeof getTopPepeHolders>>["rows"], source: SourceMeta): ChatBlock {
  const topRows = rows.slice(0, 10);
  const topShare = topRows.reduce((sum, row) => sum + (row.share ?? 0), 0);
  const data = topRows
    .filter((row) => row.share != null)
    .map((row) => ({
      name: `${row.rank}) ${row.address.slice(0, 6)}...${row.address.slice(-4)}`,
      value: Number((row.share ?? 0).toFixed(4)),
    }));

  if (topShare < 100) {
    data.push({ name: "Others", value: Number((100 - topShare).toFixed(4)) });
  }

  return {
    type: "chart",
    chartType: "pie",
    title: "PEPE supply share: top 10 holders vs others",
    xKey: "name",
    yKeys: ["value"],
    data,
    source,
  };
}

function parseDays(message: string) {
  const lower = message.toLowerCase();
  const explicitDays = lower.match(/(\d+)\s+days?/);
  if (explicitDays) return Number(explicitDays[1]);

  const weeks = lower.match(/(\d+)\s+weeks?/);
  if (weeks) return Number(weeks[1]) * 7;

  const months = lower.match(/(\d+)\s+months?/);
  if (months) return Number(months[1]) * 30;

  const years = lower.match(/(\d+)\s+years?/);
  if (years) return Number(years[1]) * 365;

  if (lower.includes("last year") || lower.includes("past year")) return 365;
  if (lower.includes("last month") || lower.includes("past month")) return 30;
  if (lower.includes("last week") || lower.includes("past week")) return 7;
  return 30;
}

function isRelativeTimeFollowUp(message: string) {
  const lower = message.toLowerCase();
  return (
    /\b(how about|what about|and|now|instead)\b/.test(lower) &&
    /\b(last|past|previous)\b/.test(lower) &&
    /\b(day|days|week|weeks|month|months|year|years)\b/.test(lower)
  );
}

function referencesTopHolderHistory(message: string) {
  const lower = message.toLowerCase();
  return (
    referencesHistoryIntent(lower) &&
    lower.includes("top") &&
    lower.includes("holder") &&
    (lower.includes("holding") || lower.includes("balance"))
  );
}

function referencesHistoryIntent(message: string) {
  const lower = message.toLowerCase();
  const asksForPlot = lower.includes("plot") || lower.includes("chart");
  const asksForHistory =
    lower.includes("history") ||
    lower.includes("historic") ||
    lower.includes("historical") ||
    lower.includes("over time");
  const asksForHolding = lower.includes("holding") || lower.includes("hold") || lower.includes("balance");
  return asksForHistory || (asksForPlot && asksForHolding);
}

function isTimeoutError(error: unknown) {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

async function getPepeHolderHistoryWithFallback(address: string, requestedDays: number): Promise<PepeHolderHistoryResult> {
  const fallbackWindows = [requestedDays, 270, 180, 90, 30].filter(
    (days, index, windows) => days > 0 && days <= requestedDays && windows.indexOf(days) === index,
  );

  let lastError: unknown;
  for (const days of fallbackWindows) {
    try {
      const history = await getPepeHolderHistory(address, days);
      return days === requestedDays
        ? { ...history, requestedDays, servedDays: days }
        : {
            ...history,
            requestedDays,
            servedDays: days,
            warning: `GoldRush timed out for the requested ${requestedDays}-day window, so I charted the latest ${days} days that returned successfully.`,
          };
    } catch (error) {
      lastError = error;
      if (!isTimeoutError(error)) throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("GoldRush history request timed out");
}

async function runTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "getTopPepeHolders":
      return getTopPepeHolders(Number(args.limit || 20));
    case "getTopPepeHolderHistory": {
      const holders = await getTopPepeHolders(1);
      const holder = holders.rows[0] ?? null;
      const history = holder ? await getPepeHolderHistoryWithFallback(holder.address, Number(args.days || 30)) : null;
      return {
        holder,
        holderSource: holders.source,
        history,
      } satisfies TopPepeHolderHistoryResult;
    }
    case "getPepeHolderBalance":
      return getPepeHolderBalance(String(args.address || ""));
    case "getWalletPortfolio":
      return getWalletPortfolio(String(args.address || ""), Number(args.days || 30));
    case "getPepeHolderHistory":
      return getPepeHolderHistoryWithFallback(String(args.address || ""), Number(args.days || 30));
    case "getPepeTransfers":
      return getPepeTransfers(String(args.address || ""), Number(args.limit || 10));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function pickHeuristicTool(
  message: string,
  contextMessages: { role: string; content: string }[] = [],
): { name: string; args: Record<string, unknown> } {
  const lower = message.toLowerCase();
  const address = message.match(addressPattern)?.[0];
  const limit = Number(message.match(/top\s+(\d+)/i)?.[1] || 20);
  const days = parseDays(message);
  const previousUserText = contextMessages
    .filter((contextMessage) => contextMessage.role === "user")
    .map((contextMessage) => contextMessage.content)
    .join("\n")
    .toLowerCase();

  if (!address && referencesTopHolderHistory(message)) {
    return { name: "getTopPepeHolderHistory", args: { days, chartType: "line" } };
  }
  if (!address && isRelativeTimeFollowUp(message) && referencesTopHolderHistory(previousUserText)) {
    return { name: "getTopPepeHolderHistory", args: { days, chartType: "line" } };
  }
  if (
    !address &&
    (lower.includes("pie") || lower.includes("chart")) &&
    (lower.includes("holder") || lower.includes("supply") || lower.includes("share"))
  ) {
    return { name: "getTopPepeHolders", args: { limit: 10, chartType: "pie", includeOthers: true } };
  }
  if (lower.includes("portfolio") && address) {
    return { name: "getWalletPortfolio", args: { address, days } };
  }
  if (referencesHistoryIntent(message) && address) {
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

function fallbackAnswer(toolName: string, toolResult: unknown, args: Record<string, unknown>) {
  if (toolName === "getTopPepeHolders") {
    const result = toolResult as Awaited<ReturnType<typeof getTopPepeHolders>>;
    const leader = result.rows[0];
    if (args.chartType === "pie") {
      const topShare = result.rows.slice(0, 10).reduce((sum, row) => sum + (row.share ?? 0), 0);
      return `Here is a native pie chart of PEPE supply share for the top 10 holders, with the remaining ${Math.max(0, 100 - topShare).toFixed(3)}% grouped as Others.`;
    }
    return leader
      ? `The largest indexed PEPE holder in this snapshot is ${leader.address}, with about ${leader.formattedBalance} PEPE.`
      : "I could not find holder rows in the current GoldRush response.";
  }
  if (toolName === "getPepeHolderHistory") {
    const result = toolResult as PepeHolderHistoryResult;
    const prefix = result.warning ? `${result.warning}\n\n` : "";
    return result.data.length
      ? `${prefix}I found ${result.data.length} PEPE balance points for this wallet and charted them below.`
      : "I could not find PEPE holding history for that wallet in the selected window.";
  }
  if (toolName === "getTopPepeHolderHistory") {
    const result = toolResult as TopPepeHolderHistoryResult;
    if (!result.holder) return "I could not identify the current top PEPE holder from GoldRush.";
    if (!result.history?.data.length) {
      return `The current top PEPE holder is ${result.holder.address}, but GoldRush did not return PEPE balance history for the selected window.`;
    }
    const warning = (result.history as PepeHolderHistoryResult).warning;
    const prefix = warning ? `${warning}\n\n` : "";
    return `${prefix}The current top PEPE holder is ${result.holder.address}. I fetched its PEPE portfolio history and charted it below.`;
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
    if (args.chartType === "pie") {
      return [holderSupplyPie(result.rows, result.source), holderTable(result.rows, result.source)];
    }
    return [holderTable(result.rows, result.source)];
  }
  if (toolName === "getPepeHolderHistory") {
    const result = toolResult as PepeHolderHistoryResult;
    return [historyChart(String(args.address), result, result.source)];
  }
  if (toolName === "getTopPepeHolderHistory") {
    const result = toolResult as TopPepeHolderHistoryResult;
    if (!result.holder || !result.history) return [];
    return [
      historyChart(result.holder.address, result.history, result.history.source),
      holderTable([result.holder], result.holderSource),
    ];
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

  const contextMessages =
    parsed.sessionId != null
      ? await prisma.chatMessage.findMany({
          where: { sessionId: session.id },
          orderBy: { createdAt: "desc" },
          take: 8,
          select: { role: true, content: true },
        })
      : [];

  await prisma.chatMessage.create({
    data: { sessionId: session.id, role: "user", content: parsed.message },
  });

  if (rejectUnsupportedToken(parsed.message)) {
    const answer = "chacha is PEPE-only in this MVP. Ask me about PEPE holders, PEPE wallet balances, or PEPE holder charts.";
    await prisma.chatMessage.create({ data: { sessionId: session.id, role: "assistant", content: answer } });
    return { sessionId: session.id, answer, blocks: [], toolCalls: [] };
  }

  const toolCall = pickHeuristicTool(parsed.message, contextMessages.reverse());
  const result = await runTool(toolCall.name, toolCall.args);

  await prisma.toolCallResult.create({
    data: {
      sessionId: session.id,
      toolName: toolCall.name,
      args: toolCall.args as Prisma.InputJsonValue,
      result: result as Prisma.InputJsonValue,
    },
  });

  const blocks = blocksFor(toolCall.name, toolCall.args, result);
  const hasChartBlock = blocks.some((block) => block.type === "chart");
  const answer =
    (!hasChartBlock ? await createAnswerWithOpenRouter(parsed.message, toolCall.name, result) : null) ||
    fallbackAnswer(toolCall.name, result, toolCall.args);

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
