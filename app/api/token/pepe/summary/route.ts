import { NextResponse } from "next/server";
import { getTopPepeHolders } from "@/lib/goldrush";
import { getServerConfig } from "@/lib/config";

export async function GET() {
  try {
    const config = getServerConfig();
    const holders = await getTopPepeHolders(10);
    return NextResponse.json({
      token: {
        symbol: "PEPE",
        chainName: config.ETHEREUM_CHAIN_NAME,
        contractAddress: config.PEPE_TOKEN_ADDRESS,
      },
      topHolders: holders.rows,
      source: holders.source,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load PEPE summary" },
      { status: 500 },
    );
  }
}
