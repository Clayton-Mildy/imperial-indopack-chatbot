/**
 * Base API client for the Imperial Indopack API (api/).
 * Server-only — never import this in Client Components.
 * API_SECRET_KEY must never be exposed to the browser.
 */

// Server-side, so prefer the container-to-container URL. NEXT_PUBLIC_API_URL is the browser's
// view of the API and is not necessarily reachable from inside this container.
const API_URL =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:50070";
const API_KEY = process.env.API_SECRET_KEY ?? "";

export interface ApiEnvelope<T> {
  data: T | null;
  error: string | null;
  meta?: {
    page: number;
    total: number;
    limit: number;
    totalPages: number;
  };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<ApiEnvelope<T>> {
  const url = `${API_URL}/api/v1${path}`;

  const method = (options?.method ?? "GET").toUpperCase();
  const hasBody = options?.body != null;

  const res = await fetch(url, {
    ...options,
    headers: {
      // Only set Content-Type for requests that actually have a body
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${API_KEY}`,
      ...options?.headers,
    },
    // Opt out of Next.js default cache for most API calls
    cache: options?.cache ?? "no-store",
  });

  // DELETE with no response body returns 200/204 with empty body — handle gracefully
  if (method === "DELETE" || res.status === 204) {
    if (!res.ok) {
      throw new ApiError(res.status, "API_ERROR", `HTTP ${res.status}`);
    }
    return { data: null as T, error: null };
  }

  const body: ApiEnvelope<T> = await res.json();

  if (!res.ok) {
    throw new ApiError(
      res.status,
      res.status === 401
        ? "UNAUTHORIZED"
        : res.status === 404
        ? "NOT_FOUND"
        : "API_ERROR",
      body.error ?? `HTTP ${res.status}`
    );
  }

  return body;
}
