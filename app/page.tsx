"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { BarChart3, Database, Loader2, Send, Sparkles, WalletCards } from "lucide-react";
import ReactMarkdown from "react-markdown";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import remarkGfm from "remark-gfm";

type SourceMeta = {
  endpoint: string;
  blockHeight?: number | string | null;
  blockSignedAt?: string | null;
  updatedAt?: string | null;
  indexedAt: string;
};

type TableBlock = {
  type: "table";
  title: string;
  columns: { key: string; label: string }[];
  rows: Record<string, string | number | null>[];
  source?: SourceMeta;
};

type ChartBlock = {
  type: "chart";
  chartType: "line" | "pie";
  title: string;
  xKey: string;
  yKeys: string[];
  data: Record<string, string | number | null>[];
  source?: SourceMeta;
};

type ChatBlock = TableBlock | ChartBlock;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  blocks?: ChatBlock[];
};

type Holder = {
  rank: number;
  address: string;
  formattedBalance: string;
  share?: number | null;
};

type Summary = {
  token: {
    symbol: string;
    chainName: string;
    contractAddress: string;
  };
  topHolders: Holder[];
  source: SourceMeta;
  error?: string;
};

const starterPrompts = [
  "Who is the biggest holder of PEPE?",
  "Show me the top 20 PEPE holders.",
  "Create a pie chart of PEPE supply held by the top 10 holders and group the rest as others.",
  "Chart this wallet's PEPE holdings over time: 0x0000000000000000000000000000000000000000",
];

const pieColors = ["#49633f", "#85a947", "#b7f26d", "#101418", "#786f61", "#d7c15c", "#4b8b89", "#9a6f45", "#6c7a89", "#c45b51", "#d8d8cc"];

function truncate(address: string) {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function SourceLine({ source }: { source?: SourceMeta }) {
  if (!source) return null;
  return (
    <p className="mt-3 break-all text-xs text-stone-500">
      GoldRush: {source.endpoint}
      {source.updatedAt ? ` | updated ${new Date(source.updatedAt).toLocaleString()}` : ""}
    </p>
  );
}

function DataTable({ block }: { block: TableBlock }) {
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-stone-200 bg-white">
      <div className="border-b border-stone-200 px-4 py-3 text-sm font-semibold">{block.title}</div>
      <div className="max-h-96 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              {block.columns.map((column) => (
                <th key={column.key} className="whitespace-nowrap px-4 py-3 font-semibold">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, index) => (
              <tr key={index} className="border-t border-stone-100">
                {block.columns.map((column) => {
                  const value = row[column.key];
                  const display = column.key.toLowerCase().includes("address") || column.key === "contract"
                    ? truncate(String(value || ""))
                    : value;
                  return (
                    <td key={column.key} className="whitespace-nowrap px-4 py-3 text-stone-700">
                      {display ?? "-"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 pb-3">
        <SourceLine source={block.source} />
      </div>
    </div>
  );
}

function ChartCard({ block }: { block: ChartBlock }) {
  const valueKey = block.yKeys[0] || "value";

  return (
    <div className="mt-4 rounded-lg border border-stone-200 bg-white p-4">
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
        <BarChart3 size={16} />
        {block.title}
      </div>
      <div className="h-72 w-full">
        {block.chartType === "pie" ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Pie
                data={block.data}
                dataKey={valueKey}
                nameKey={block.xKey}
                cx="50%"
                cy="50%"
                outerRadius="82%"
                label={({ name, value }) => `${name}: ${Number(value).toFixed(2)}%`}
                labelLine={false}
              >
                {block.data.map((_, index) => (
                  <Cell key={index} fill={pieColors[index % pieColors.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => `${Number(value).toFixed(4)}%`} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={block.data} margin={{ top: 12, right: 12, bottom: 12, left: 12 }}>
              <CartesianGrid stroke="#e7e5df" />
              <XAxis dataKey={block.xKey} tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} width={72} />
              <Tooltip />
              {block.yKeys.map((key) => (
                <Line key={key} type="monotone" dataKey={key} stroke="#49633f" strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <SourceLine source={block.source} />
    </div>
  );
}

function BlockRenderer({ block }: { block: ChatBlock }) {
  if (block.type === "table") return <DataTable block={block} />;
  return <ChartCard block={block} />;
}

function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold">{children}</h3>,
        h2: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold">{children}</h3>,
        h3: ({ children }) => <h3 className="mb-2 mt-3 text-sm font-semibold">{children}</h3>,
        p: ({ children }) => <p className="mb-3 whitespace-pre-wrap leading-6 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
        ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
        li: ({ children }) => <li className="leading-6">{children}</li>,
        strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
        code: ({ children }) => (
          <code className="rounded bg-stone-200 px-1 py-0.5 font-mono text-[0.9em] text-ink">{children}</code>
        ),
        pre: ({ children }) => (
          <pre className="mb-3 overflow-x-auto rounded-md bg-ink p-3 text-xs text-white last:mb-0">{children}</pre>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export default function Home() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [input, setInput] = useState(starterPrompts[0]);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "Ask me about PEPE holders, wallet portfolios, or holder history charts.",
    },
  ]);

  useEffect(() => {
    fetch("/api/token/pepe/summary")
      .then((res) => res.json())
      .then(setSummary)
      .catch(() => setSummary({} as Summary));
  }, []);

  const topHolder = useMemo(() => summary?.topHolders?.[0], [summary]);

  async function submit(message = input) {
    const trimmed = message.trim();
    if (!trimmed || loading) return;
    setInput("");
    setLoading(true);
    setMessages((current) => [...current, { role: "user", content: trimmed }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Chat request failed");
      setSessionId(json.sessionId);
      setMessages((current) => [
        ...current,
        { role: "assistant", content: json.answer, blocks: json.blocks || [] },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: error instanceof Error ? error.message : "Unable to answer right now.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  return (
    <main className="min-h-screen bg-paper">
      <div className="mx-auto grid min-h-screen max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[360px_1fr]">
        <aside className="flex flex-col gap-4">
          <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-semibold tracking-normal">chacha</h1>
                <p className="mt-1 text-sm text-stone-500">AI-native PEPE explorer</p>
              </div>
              <div className="rounded-full bg-acid p-3 text-ink">
                <Sparkles size={22} />
              </div>
            </div>
            <div className="mt-6 space-y-4 text-sm">
              <div className="flex items-start gap-3">
                <Database className="mt-0.5 text-moss" size={18} />
                <div>
                  <div className="font-medium">Ethereum</div>
                  <div className="break-all text-stone-500">
                    {summary?.token?.contractAddress || "Loading PEPE contract..."}
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <WalletCards className="mt-0.5 text-moss" size={18} />
                <div>
                  <div className="font-medium">Largest fetched holder</div>
                  <div className="text-stone-500">
                    {topHolder ? `${truncate(topHolder.address)} | ${topHolder.formattedBalance} PEPE` : "Loading..."}
                  </div>
                </div>
              </div>
            </div>
            {summary?.error ? <p className="mt-4 text-sm text-red-600">{summary.error}</p> : null}
            <SourceLine source={summary?.source} />
          </section>

          <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
            <div className="mb-3 text-sm font-semibold">Try a query</div>
            <div className="space-y-2">
              {starterPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => void submit(prompt)}
                  className="w-full rounded-md border border-stone-200 px-3 py-2 text-left text-sm text-stone-700 hover:border-moss hover:bg-stone-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="flex min-h-[calc(100vh-3rem)] flex-col rounded-lg border border-stone-200 bg-white shadow-sm">
          <div className="border-b border-stone-200 px-5 py-4">
            <h2 className="text-lg font-semibold">PEPE chat</h2>
            <p className="text-sm text-stone-500">GoldRush-backed answers with charts and source metadata.</p>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            {messages.map((message, index) => (
              <div key={index} className={message.role === "user" ? "flex justify-end" : "block"}>
                <div
                  className={
                    message.role === "user"
                      ? "max-w-2xl rounded-lg bg-ink px-4 py-3 text-sm text-white"
                      : "max-w-4xl rounded-lg bg-stone-50 px-4 py-3 text-sm text-stone-800"
                  }
                >
                  <MarkdownMessage content={message.content} />
                  {message.blocks?.map((block, blockIndex) => <BlockRenderer key={blockIndex} block={block} />)}
                </div>
              </div>
            ))}
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-stone-500">
                <Loader2 className="animate-spin" size={16} />
                Querying chacha tools...
              </div>
            ) : null}
          </div>

          <form onSubmit={onSubmit} className="border-t border-stone-200 p-4">
            <div className="flex gap-3">
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask about PEPE holders or paste an Ethereum address..."
                className="min-w-0 flex-1 rounded-md border border-stone-300 bg-white px-4 py-3 text-sm outline-none focus:border-moss focus:ring-2 focus:ring-acid"
              />
              <button
                type="submit"
                disabled={loading}
                className="inline-flex h-12 w-12 items-center justify-center rounded-md bg-moss text-white hover:bg-ink disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Send message"
                title="Send message"
              >
                {loading ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
