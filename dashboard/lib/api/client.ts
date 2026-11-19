/**
 * Base API client for the Imperial Indopack API (api/).
 * Server-only — never import this in Client Components.
 * API_SECRET_KEY must never be exposed to the browser.
 */

import { isUuid } from "@/lib/ids";

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
    message: string,
    /** The body's `details`, when the API sent one (the catalog editor's per-field errors). */
    public details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * An id the dashboard puts into an API path, checked and encoded. Ids reach these helpers from route
 * params (which Next decodes: "..%2Fnumbers" arrives as "../numbers"), query strings and server-action
 * arguments a browser can call with anything - unchecked, "../catalog/import?" walks the path to another,
 * possibly admin-only, API endpoint. Anything but a uuid throws ApiError(404) and nothing is sent.
 */
export function pathId(id: unknown): string {
  if (!isUuid(id)) throw new ApiError(404, "NOT_FOUND", "Invalid id");
  return encodeURIComponent(id);
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

  // DELETE may answer 204 or 200 with an empty body — handle gracefully. A DELETE that does send
  // an envelope (the catalog's { sizes, tiers }) has it returned.
  if (method === "DELETE" || res.status === 204) {
    if (!res.ok) {
      throw new ApiError(res.status, "API_ERROR", `HTTP ${res.status}`);
    }
    const text = res.status === 204 ? "" : await res.text();
    if (!text) return { data: null as T, error: null };
    try {
      return JSON.parse(text) as ApiEnvelope<T>;
    } catch {
      return { data: null as T, error: null };
    }
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
      body.error ?? `HTTP ${res.status}`,
      (body as { details?: unknown }).details
    );
  }

  return body;
}
