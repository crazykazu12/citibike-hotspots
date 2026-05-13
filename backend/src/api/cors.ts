// Public read-only API: no auth, no credentials, allow any origin. The 30s
// edge cache aligns with the frontend poll cadence so a single popular tab
// doesn't multiply D1 reads across the world.

const COMMON_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: COMMON_HEADERS })
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...COMMON_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=30',
    },
  })
}

export function errorResponse(message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...COMMON_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}
