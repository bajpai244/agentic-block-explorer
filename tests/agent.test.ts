import { beforeEach, describe, expect, it, vi } from "vitest";

const getPepeHolderHistoryMock = vi.fn(async () => ({
  token: "PEPE",
  data: [{ date: "2026-07-01", balance: 100, quote: 1, quoteRate: 0.01 }],
  source: { endpoint: "/portfolio", indexedAt: "2026-07-01T00:00:00.000Z" },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatSession: {
      create: vi.fn(async () => ({ id: "session_1" })),
      upsert: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id })),
    },
    chatMessage: {
      create: vi.fn(async () => ({})),
      findMany: vi.fn(async () => [
        {
          role: "user",
          content: "can you plot the holding of the top holder's holding of chacha for the last 30 days",
        },
      ]),
    },
    toolCallResult: {
      create: vi.fn(async () => ({})),
    },
  },
}));

vi.mock("@/lib/goldrush", () => ({
  getTopPepeHolders: vi.fn(async () => ({
    rows: [
      {
        rank: 1,
        address: "0x1111111111111111111111111111111111111111",
        balance: "100000000000000000000",
        formattedBalance: "100",
        quote: null,
        share: 1.23,
      },
    ],
    source: {
      endpoint: "/eth-mainnet/tokens/pepe/token_holders_v2",
      indexedAt: "2026-07-01T00:00:00.000Z",
    },
  })),
  getPepeHolderBalance: vi.fn(async () => ({
    row: null,
    source: { endpoint: "/holders", indexedAt: "2026-07-01T00:00:00.000Z" },
  })),
  getPepeHolderHistory: getPepeHolderHistoryMock,
  getPepeTransfers: vi.fn(async () => ({
    items: [],
    source: { endpoint: "/transfers", indexedAt: "2026-07-01T00:00:00.000Z" },
  })),
  getWalletPortfolio: vi.fn(async () => ({
    address: "0x1111111111111111111111111111111111111111",
    items: [],
    source: { endpoint: "/portfolio", indexedAt: "2026-07-01T00:00:00.000Z" },
  })),
}));

describe("handleChat", () => {
  beforeEach(() => {
    vi.resetModules();
    getPepeHolderHistoryMock.mockClear();
    process.env.GOLDRUSH_API_KEY = "test";
    process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/chacha";
  });

  it("answers top-holder queries with a table block", async () => {
    const { handleChat } = await import("@/lib/agent");
    const result = await handleChat({ message: "Who is the biggest holder of PEPE?" });
    expect(result.sessionId).toBe("session_1");
    expect(result.blocks[0]?.type).toBe("table");
    expect(result.toolCalls[0]?.name).toBe("getTopPepeHolders");
  });

  it("answers history queries with a chart block", async () => {
    const { handleChat } = await import("@/lib/agent");
    const result = await handleChat({
      message: "chart 0x1111111111111111111111111111111111111111 over time",
    });
    expect(result.blocks[0]?.type).toBe("chart");
    expect(result.toolCalls[0]?.name).toBe("getPepeHolderHistory");
  });

  it("routes explicit historic hold prompts to holder history", async () => {
    const { handleChat } = await import("@/lib/agent");
    const address = "0x6982508145454ce325ddbe47a25d4ec3d2311933";
    const result = await handleChat({
      message: `${address} plot historic hold of this account for the last 1 year`,
    });
    expect(result.toolCalls[0]).toMatchObject({
      name: "getPepeHolderHistory",
      args: { address, days: 365 },
    });
    expect(getPepeHolderHistoryMock).toHaveBeenCalledWith(address, 365);
    expect(result.blocks[0]).toMatchObject({ type: "chart", chartType: "line" });
  });

  it("falls back to a shorter history window when GoldRush times out", async () => {
    getPepeHolderHistoryMock
      .mockRejectedValueOnce(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }))
      .mockResolvedValueOnce({
        token: "PEPE",
        data: [{ date: "2026-07-01", balance: 100, quote: 1, quoteRate: 0.01 }],
        source: { endpoint: "/portfolio?days=270", indexedAt: "2026-07-01T00:00:00.000Z" },
      });

    const { handleChat } = await import("@/lib/agent");
    const address = "0x6982508145454ce325ddbe47a25d4ec3d2311933";
    const result = await handleChat({
      message: `${address} plot historic hold of this account for the last 1 year`,
    });

    expect(getPepeHolderHistoryMock).toHaveBeenNthCalledWith(1, address, 365);
    expect(getPepeHolderHistoryMock).toHaveBeenNthCalledWith(2, address, 270);
    expect(result.answer).toMatch(/timed out/i);
    expect(result.blocks[0]).toMatchObject({ type: "chart", chartType: "line" });
  });

  it("answers top-holder pie chart queries with a pie chart block", async () => {
    const { handleChat } = await import("@/lib/agent");
    const result = await handleChat({
      message: "can you create a pie chart of the supply held by 10 top holders and the rest as others",
    });
    expect(result.blocks[0]).toMatchObject({ type: "chart", chartType: "pie" });
    expect(result.blocks[1]?.type).toBe("table");
  });

  it("plots the current top holder history by chaining holder lookup into portfolio history", async () => {
    const { handleChat } = await import("@/lib/agent");
    const result = await handleChat({
      message: "can you plot the holding of the top holder's holding of chacha for the last 30 days",
    });
    expect(result.toolCalls[0]?.name).toBe("getTopPepeHolderHistory");
    expect(getPepeHolderHistoryMock).toHaveBeenCalledWith("0x1111111111111111111111111111111111111111", 30);
    expect(result.blocks[0]).toMatchObject({ type: "chart", chartType: "line" });
    expect(result.blocks[1]?.type).toBe("table");
  });

  it("understands year windows for top-holder history", async () => {
    const { handleChat } = await import("@/lib/agent");
    const result = await handleChat({
      message: "can you plot the holding of the top holder's holding of chacha for the last 1 year",
    });
    expect(result.toolCalls[0]).toMatchObject({
      name: "getTopPepeHolderHistory",
      args: { days: 365, chartType: "line" },
    });
    expect(getPepeHolderHistoryMock).toHaveBeenCalledWith("0x1111111111111111111111111111111111111111", 365);
  });

  it("uses prior chat context for relative time-window follow-ups", async () => {
    const { handleChat } = await import("@/lib/agent");
    const result = await handleChat({
      sessionId: "session_1",
      message: "how about in the last 1 year",
    });
    expect(result.toolCalls[0]).toMatchObject({
      name: "getTopPepeHolderHistory",
      args: { days: 365, chartType: "line" },
    });
    expect(result.blocks[0]).toMatchObject({ type: "chart", chartType: "line" });
  });

  it("rejects unsupported non-PEPE tokens", async () => {
    const { handleChat } = await import("@/lib/agent");
    const result = await handleChat({ message: "show top SHIB holders" });
    expect(result.answer).toMatch(/PEPE-only/);
    expect(result.toolCalls).toHaveLength(0);
  });
});
