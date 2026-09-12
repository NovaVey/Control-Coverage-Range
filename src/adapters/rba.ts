/**
 * A real HTTP client for relationship-based-authorization's own API
 * (src/api/server.ts) — every route here is confirmed directly against that
 * project's source and docs/openapi.json, not inferred from its README
 * alone. Bearer-authenticated throughout; this range always uses the ADMIN
 * key (writes AND reads — RBA's own D-064 makes ADMIN authorize every
 * gated route, not just writes) since scenarios both seed tuples/schema
 * and check them.
 */

export interface NsId {
  ns: string;
  id: string;
}

export interface CheckRequest {
  subject: NsId;
  relation: string;
  object: NsId;
  atToken?: string;
}

export interface CheckResponse {
  allowed: boolean;
  subject: NsId;
  relation: string;
  object: NsId;
  depth: number;
  atToken: string;
  path?: unknown;
}

export interface ScopeTarget {
  namespace: string;
  relationOrPermission: string;
}

export interface ScopeGrantResult {
  namespace: string;
  relationOrPermission: string;
  granted?: boolean;
  truncated?: boolean;
  error?: { code: string; message: string };
}

export interface ScopeResponse {
  subject: NsId;
  grants: ScopeGrantResult[];
  atToken: string;
}

export interface TupleWrite {
  objectNs: string;
  objectId: string;
  relation: string;
  subjectNs: string;
  subjectId: string;
  subjectRelation?: string;
  expiresAt?: string;
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export class RbaError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`RBA ${code}: ${message} (HTTP ${status})`);
    this.name = "RbaError";
  }
}

export class RbaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly adminApiKey: string,
  ) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(new URL(path, this.baseUrl), {
      method,
      headers: {
        Authorization: `Bearer ${this.adminApiKey}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json()) as unknown;
    if (!res.ok) {
      const apiError = json as ApiError;
      throw new RbaError(
        res.status,
        apiError.error?.code ?? "unknown_error",
        apiError.error?.message ?? res.statusText,
      );
    }
    return json as T;
  }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(new URL("/health", this.baseUrl));
      if (!res.ok) return false;
      const body = (await res.json()) as { status?: string };
      return body.status === "ok";
    } catch {
      return false;
    }
  }

  async compileSchema(source: string): Promise<unknown> {
    return this.request("POST", "/schema/compile", { source });
  }

  /** Additive/versioned — republishing an identical schema across scenarios sharing one
   * RBA instance in a run is a harmless no-op version bump (docs/DECISIONS.md), not an
   * error, so scenarios don't need to coordinate who publishes first. */
  async publishSchema(
    source: string,
  ): Promise<{ published: Array<{ namespace: string; version: number }> }> {
    return this.request("POST", "/schema/publish", { source });
  }

  async writeTuple(tuple: TupleWrite): Promise<{
    token: string;
    created: boolean;
    existingExpiresAt?: string | null;
  }> {
    return this.request("POST", "/tuples", tuple);
  }

  async writeTuplesBatch(
    tuples: TupleWrite[],
  ): Promise<{ results: unknown[] }> {
    return this.request("POST", "/tuples/batch", { tuples });
  }

  async deleteTuple(
    tuple: Omit<TupleWrite, "expiresAt">,
  ): Promise<{ token: string; deleted: boolean }> {
    return this.request("DELETE", "/tuples", tuple);
  }

  async check(req: CheckRequest): Promise<CheckResponse> {
    return this.request("POST", "/check", req);
  }

  /** POST /scope — "does subject hold at least one grant of this relation/permission on
   * ANY object of this namespace" — an existence check, not enumeration. This is the exact
   * endpoint the ADC mint service's own bounding.ts calls for a wildcard scope caveat, and
   * is also the mechanism the over-broad-delegation identity row (taxonomy/identity-controls.yaml)
   * depends on. */
  async scope(
    subject: NsId,
    targets: ScopeTarget[],
    atToken?: string,
  ): Promise<ScopeResponse> {
    return this.request("POST", "/scope", { subject, targets, atToken });
  }

  /** POST /list-users — D-171's own genuine refusal for a co-finite subject shape (a
   * wildcard grant minus concrete exceptions) returns {unenumerable:true,
   * reason:"wildcardMinusConcreteExceptions"} instead of an approximate answer; every
   * other case returns a concrete/wildcard subject list. See
   * taxonomy/gaps/rba.yaml's listusers-wildcard-unenumerable-refusal row. */
  async listUsers(object: NsId, relation: string): Promise<ListUsersResponse> {
    return this.request("POST", "/list-users", { object, relation });
  }
}

export type ListUsersResponse =
  | {
      object: NsId;
      relation: string;
      subjects: Array<
        | { kind: "concrete"; ns: string; id: string }
        | { kind: "wildcard"; ns: string }
      >;
    }
  | {
      object: NsId;
      relation: string;
      unenumerable: true;
      ns: string;
      reason: string;
    };
