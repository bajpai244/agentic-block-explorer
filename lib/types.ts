export type SourceMeta = {
  endpoint: string;
  blockHeight?: number | string | null;
  blockSignedAt?: string | null;
  updatedAt?: string | null;
  indexedAt: string;
};

export type HolderRow = {
  rank: number;
  address: string;
  balance: string;
  formattedBalance: string;
  quote?: number | null;
  share?: number | null;
};

export type TableBlock = {
  type: "table";
  title: string;
  columns: { key: string; label: string }[];
  rows: Record<string, string | number | null>[];
  source?: SourceMeta;
};

export type ChartBlock = {
  type: "chart";
  title: string;
  xKey: string;
  yKeys: string[];
  data: Record<string, string | number | null>[];
  source?: SourceMeta;
};

export type ChatBlock = TableBlock | ChartBlock;

export type ChatResponse = {
  sessionId: string;
  answer: string;
  blocks: ChatBlock[];
  toolCalls: { name: string; args: Record<string, unknown> }[];
};
