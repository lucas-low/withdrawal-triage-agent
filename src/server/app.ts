import { z } from "zod";
import type { App } from "../container";
import { resetDemo } from "../demo";
import { AppError } from "../domain/errors";
import { DecisionInputSchema, type Principal, type ProposalStatus, type Role } from "../domain/types";
import { RateLimiter } from "./ratelimit";
import { UI_HTML } from "./ui";

const MAX_BODY_BYTES = 8 * 1024;
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
};

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...SECURITY_HEADERS, ...extra } });

const StatusSchema = z.enum(["pending", "approved", "rejected", "expired"]);

/** Builds the request handler. Kept separate from Bun.serve so tests call it directly. */
export function createHandler(app: App, opts: { triageLimitPerMinute?: number } = {}) {
  const limiter = new RateLimiter(opts.triageLimitPerMinute ?? 30, 60_000, () => app.clock.now().getTime());

  const authenticate = (req: Request): Principal => {
    const header = req.headers.get("authorization") ?? "";
    const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const principal = key ? app.config.apiKeys.get(key) : undefined;
    if (!principal) throw new AppError("unauthorized", "missing or invalid bearer token");
    return principal;
  };
  const requireRole = (p: Principal, ...roles: Role[]) => {
    if (!roles.includes(p.role)) throw new AppError("forbidden", `requires role ${roles.join(" or ")}`);
  };
  const readJson = async (req: Request) => {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) throw new AppError("invalid_request", "body too large");
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new AppError("invalid_request", "body is not valid JSON");
    }
  };

  interface Ctx {
    req: Request;
    url: URL;
    principal: Principal;
    params: string[];
  }
  interface Route {
    method: string;
    pattern: RegExp;
    handle: (c: Ctx) => Response | Promise<Response>;
  }

  const routes: Route[] = [
    {
      method: "POST",
      pattern: /^\/v1\/demo\/reset$/,
      handle: ({ principal }) => {
        if (!app.config.demoMode) throw new AppError("not_found", "no route for POST /v1/demo/reset");
        requireRole(principal, "operator");
        resetDemo(app);
        return json(200, { ok: true });
      },
    },
    {
      method: "GET",
      pattern: /^\/v1\/withdrawals$/,
      handle: ({ url }) => {
        const status = url.searchParams.get("status") ?? "pending_review";
        return json(200, { withdrawals: app.store.listWithdrawals({ status: status as never }) });
      },
    },
    {
      method: "POST",
      pattern: /^\/v1\/withdrawals\/([\w-]+)\/triage$/,
      handle: async ({ principal, params }) => {
        requireRole(principal, "operator", "reviewer");
        const wait = limiter.check(principal.name);
        if (wait)
          return json(429, { error: { code: "rate_limited", message: "too many triage requests" } }, { "retry-after": String(wait) });
        const { proposal, reused } = await app.triage.triage(params[0]!, principal.name);
        return json(reused ? 200 : 201, { proposal, reused });
      },
    },
    {
      method: "GET",
      pattern: /^\/v1\/proposals$/,
      handle: ({ url }) => {
        app.review.expireOverdue();
        const raw = url.searchParams.get("status");
        const status = raw ? (StatusSchema.parse(raw) as ProposalStatus) : undefined;
        return json(200, { proposals: app.store.listProposals({ status }) });
      },
    },
    {
      method: "GET",
      pattern: /^\/v1\/proposals\/([\w-]+)$/,
      handle: ({ params }) => {
        const p = app.store.getProposal(params[0]!);
        if (!p) throw new AppError("not_found", `proposal ${params[0]} not found`);
        return json(200, { proposal: p });
      },
    },
    {
      method: "POST",
      pattern: /^\/v1\/proposals\/([\w-]+)\/decision$/,
      handle: async ({ req, principal, params }) => {
        requireRole(principal, "reviewer");
        const input = DecisionInputSchema.parse(await readJson(req));
        return json(200, app.review.decide(params[0]!, principal, input));
      },
    },
    {
      method: "GET",
      pattern: /^\/v1\/proposals\/([\w-]+)\/audit$/,
      handle: ({ principal, params }) => {
        requireRole(principal, "reviewer", "auditor");
        return json(200, { records: app.audit.list({ proposalId: params[0]! }) });
      },
    },
    {
      method: "GET",
      pattern: /^\/v1\/audit\/verify$/,
      handle: ({ principal }) => {
        requireRole(principal, "reviewer", "auditor");
        return json(200, app.audit.verify());
      },
    },
  ];

  async function route(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const { pathname: path } = url;

    if (req.method === "GET" && path === "/healthz")
      return json(200, {
        ok: true,
        demo: app.config.demoMode,
        model: app.config.modelProvider === "mock" ? `mock/${app.config.mockBehavior}` : app.config.model,
      });
    if (req.method === "GET" && path === "/") {
      return new Response(UI_HTML, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
          ...SECURITY_HEADERS,
        },
      });
    }

    const principal = authenticate(req);
    for (const r of routes) {
      const match = r.method === req.method ? path.match(r.pattern) : null;
      if (match) return r.handle({ req, url, principal, params: match.slice(1) });
    }
    throw new AppError("not_found", `no route for ${req.method} ${path}`);
  }

  return async (req: Request): Promise<Response> => {
    const requestId = crypto.randomUUID();
    try {
      const res = await route(req);
      res.headers.set("x-request-id", requestId);
      return res;
    } catch (err) {
      if (err instanceof z.ZodError) {
        return json(
          400,
          { error: { code: "invalid_request", message: err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") } },
          { "x-request-id": requestId },
        );
      }
      if (err instanceof AppError) {
        return json(err.status, { error: { code: err.code, message: err.message } }, { "x-request-id": requestId });
      }
      if (app.config.logLevel !== "silent") console.error(JSON.stringify({ requestId, error: String(err) }));
      return json(500, { error: { code: "internal", message: "internal error" } }, { "x-request-id": requestId });
    }
  };
}
