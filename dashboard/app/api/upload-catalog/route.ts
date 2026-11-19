import { NextRequest, NextResponse } from 'next/server';

// Route handler = server-side; prefer the container-to-container URL over the browser's view.
const API_URL =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:50070';
const API_KEY = process.env.API_SECRET_KEY ?? '';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const res = await fetch(`${API_URL}/api/v1/upload/catalog`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: formData,
  });
  const body = await res.json();
  return NextResponse.json(body, { status: res.status });
}
