import { NextRequest, NextResponse } from "next/server";
import { listActivityLogs } from "@/lib/api/activityLogs";

/**
 * Proxy route: GET /api/activity-logs
 * Proxies to the backend activity-logs endpoint so the client component
 * can fetch activity logs without exposing API_SECRET_KEY to the browser.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const page = searchParams.get("page") ? Number(searchParams.get("page")) : 1;
  const limit = searchParams.get("limit") ? Number(searchParams.get("limit")) : 20;
  const search = searchParams.get("search") ?? undefined;
  const startDate = searchParams.get("startDate") ?? undefined;
  const endDate = searchParams.get("endDate") ?? undefined;

  try {
    const result = await listActivityLogs({ page, limit, search, startDate, endDate });
    return NextResponse.json(result);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : "Gagal memuat aktivitas";
    return NextResponse.json({ data: [], meta: { page: 1, total: 0, limit }, error: message }, { status });
  }
}
