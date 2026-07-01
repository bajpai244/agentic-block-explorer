import { getCachedJson, setCachedJson } from "@/lib/cache";
import { getServerConfig } from "@/lib/config";
import type { HolderRow, SourceMeta } from "@/lib/types";

type GoldRushEnvelope<T> = {
  data?: T;
  error?: boolean;
  error_message?: string;
};

type TokenHolderItem = {
  address?: string;
  contract_decimals?: number;
  balance?: string;
  total_supply?: string;
  quote?: number | null;
  pretty_quote?: string | null;
  block_height?: number | string | null;
  block_signed_at?: string | null;
};

type TokenHoldersData = {
  items?: TokenHolderItem[];
  pagination?: {
    has_more?: boolean;
    page_number?: number;
    page_size?: number;
  };
  updated_at?: string;
  chain_name?: string;
};

type PortfolioHolding = {
  timestamp?: string;
  close?: {
    balance?: string;
    quote?: number | null;
    quote_rate?: number | null;
  };
  balance?: string;
  quote?: number | null;
  quote_rate?: number | null;
};

type PortfolioItem = {
  contract_address?: string;
  contract_decimals?: number;
  contract_name?: string;
  contract_ticker_symbol?: string;
  logo_url?: string | null;
  holdings?: PortfolioHolding[];
};

type PortfolioData = {
  address?: string;
  updated_at?: string;
  quote_currency?: string;
  chain_name?: string;
  items?: PortfolioItem[];
};

type TransferItem = {
  block_signed_at?: string;
  block_height?: number;
  tx_hash?: string;
  from_address?: string;
  to_address?: string;
  delta?: string;
  contract_decimals?: number;
  contract_ticker_symbol?: string;
};

type TransferData = {
  items?: TransferItem[];
  pagination?: { has_more?: boolean };
};

function baseUrl() {
  return "https://api.covalenthq.com/v1";
}

function normalizeAddress(address: string) {
  return address.toLowerCase();
}

export function formatTokenAmount(raw?: string, decimals = 18) {
  if (!raw) return "0";
  const negative = raw.startsWith("-");
  const digits = negative ? raw.slice(1) : raw;
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "").slice(0, 6);
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function source(endpoint: string, data?: { updated_at?: string }, item?: TokenHolderItem): SourceMeta {
  return {
    endpoint,
    blockHeight: item?.block_height ?? null,
    blockSignedAt: item?.block_signed_at ?? null,
    updatedAt: data?.updated_at ?? null,
    indexedAt: new Date().toISOString(),
  };
}

async function goldRushGet<T>(endpoint: string, ttlSeconds = 300): Promise<T> {
  const cached = await getCachedJson<T>(endpoint);
  if (cached) return cached;

  const { GOLDRUSH_API_KEY } = getServerConfig();
  const res = await fetch(`${baseUrl()}${endpoint}`, {
    headers: {
      accept: "application/json",
      Authorization: `Bearer ${GOLDRUSH_API_KEY}`,
    },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) {
    throw new Error(`GoldRush ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as GoldRushEnvelope<T>;
  if (json.error) {
    throw new Error(json.error_message || "GoldRush returned an error");
  }
  if (!json.data) {
    throw new Error("GoldRush response did not include data");
  }
  await setCachedJson(endpoint, endpoint, json.data, ttlSeconds);
  return json.data;
}

export async function getTopPepeHolders(limit = 20) {
  const config = getServerConfig();
  const pageSize = limit > 100 ? 1000 : 100;
  const endpoint = `/${config.ETHEREUM_CHAIN_NAME}/tokens/${config.PEPE_TOKEN_ADDRESS}/token_holders_v2/?page-size=${pageSize}`;
  const data = await goldRushGet<TokenHoldersData>(endpoint, 900);
  const rows: HolderRow[] = (data.items || []).slice(0, limit).map((item, index) => ({
    rank: index + 1,
    address: item.address || "",
    balance: item.balance || "0",
    formattedBalance: formatTokenAmount(item.balance, item.contract_decimals ?? 18),
    quote: item.quote ?? null,
    share:
      item.balance && item.total_supply
        ? Number((Number(item.balance) / Number(item.total_supply)) * 100)
        : null,
  }));
  return { rows, source: source(endpoint, data, data.items?.[0]) };
}

export async function getPepeHolderBalance(address: string) {
  const { rows, source: meta } = await getTopPepeHolders(1000);
  const normalized = normalizeAddress(address);
  const row = rows.find((holder) => normalizeAddress(holder.address) === normalized);
  return { row: row ?? null, source: meta };
}

export async function getWalletPortfolio(address: string, days = 30) {
  const config = getServerConfig();
  const endpoint = `/${config.ETHEREUM_CHAIN_NAME}/address/${address}/portfolio_v2/?quote-currency=USD&days=${days}`;
  const data = await goldRushGet<PortfolioData>(endpoint, 900);
  return {
    address: data.address || address,
    items: data.items || [],
    source: {
      endpoint,
      updatedAt: data.updated_at ?? null,
      indexedAt: new Date().toISOString(),
    } satisfies SourceMeta,
  };
}

export async function getPepeHolderHistory(address: string, days = 30) {
  const config = getServerConfig();
  const portfolio = await getWalletPortfolio(address, days);
  const pepe = portfolio.items.find(
    (item) => normalizeAddress(item.contract_address || "") === normalizeAddress(config.PEPE_TOKEN_ADDRESS),
  );
  const data = (pepe?.holdings || []).map((holding) => {
    const balance = holding.close?.balance ?? holding.balance ?? "0";
    return {
      date: (holding.timestamp || "").slice(0, 10),
      balance: Number(formatTokenAmount(balance, pepe?.contract_decimals ?? 18)),
      quote: holding.close?.quote ?? holding.quote ?? null,
      quoteRate: holding.close?.quote_rate ?? holding.quote_rate ?? null,
    };
  });
  return {
    token: pepe?.contract_ticker_symbol || "PEPE",
    data,
    source: portfolio.source,
  };
}

export async function getPepeTransfers(address: string, limit = 10) {
  const config = getServerConfig();
  const endpoint = `/${config.ETHEREUM_CHAIN_NAME}/address/${address}/transfers_v2/?contract-address=${config.PEPE_TOKEN_ADDRESS}&page-size=100`;
  const data = await goldRushGet<TransferData>(endpoint, 900);
  return {
    items: (data.items || []).slice(0, limit),
    source: {
      endpoint,
      indexedAt: new Date().toISOString(),
    } satisfies SourceMeta,
  };
}
