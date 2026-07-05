import { NextRequest, NextResponse } from "next/server";
import { diffAndSummarize } from "@/lib/diff";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const today = body?.today;
    const yesterday = body?.yesterday;

    if (typeof today !== "string" || typeof yesterday !== "string") {
      return NextResponse.json(
        { error: "Both 'today' and 'yesterday' string fields are required" },
        { status: 400 }
      );
    }

    const result = await diffAndSummarize(yesterday, today);
    return NextResponse.json(result);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "GEMINI_API_KEY is not configured"
    ) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(
      { error: "Failed to compute diff summary" },
      { status: 500 }
    );
  }
}
