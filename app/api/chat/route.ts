import { NextResponse } from "next/server";
import { handleChat } from "@/lib/agent";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const response = await handleChat(body);
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown chat error" },
      { status: 400 },
    );
  }
}
