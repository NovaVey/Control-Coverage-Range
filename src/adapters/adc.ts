import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import {
  mintRoot,
  attenuate,
  seal,
  type Caveat,
  type ParsedToken,
} from "@adc/core";
import { createRevocationClient } from "@adc/revocation";
import type { Scenario } from "../types/scenario.js";

export interface MintRequest {
  subject: { ns: string; id: string };
  caveats: Caveat[];
}

export interface MintClientOptions {
  baseUrl: string;
  adminApiKey: string;
}

/** A real HTTP client for services/mint's own API (src/server.ts) — see
 * ARCHITECTURE.md for why this range writes that service its own Dockerfile
 * (the real source has none) rather than skipping it. */
export class MintClient {
  constructor(private readonly opts: MintClientOptions) {}

  async health(): Promise<boolean> {
    try {
      const res = await fetch(new URL("/health", this.opts.baseUrl));
      return res.ok;
    } catch {
      return false;
    }
  }

  async mint(req: MintRequest): Promise<{ token: string; depth: number }> {
    const res = await fetch(new URL("/mint", this.opts.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    const body = (await res.json()) as {
      token?: string;
      depth?: number;
      error?: string;
    };
    if (!res.ok)
      throw new Error(
        `mint service POST /mint failed: HTTP ${res.status} ${body.error ?? ""}`,
      );
    return { token: body.token!, depth: body.depth! };
  }

  async revoke(blockSignatureHashHex: string, reason?: string): Promise<void> {
    const res = await fetch(new URL("/revoke", this.opts.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.opts.adminApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ hash: blockSignatureHashHex, reason }),
    });
    if (!res.ok)
      throw new Error(`mint service POST /revoke failed: HTTP ${res.status}`);
  }
}

/**
 * mintRoot()/attenuate()/seal() called directly, in-process, with no RBA scope-bounding at
 * all — for a scenario that needs to construct a chain shape the real bounded mint service
 * would refuse to issue (docs/PLAN.md Phase 4's own all-or-nothing bounding), e.g. modeling
 * a token minted before a grant was later revoked, or an intentionally-adversarial chain for
 * a stale-grant-abuse scenario. Always a deliberate scenario-authoring choice, documented per
 * scenario via adcTokens[].offline — never a silent substitute for the real mint path.
 */
export function mintOffline(
  rootSecretKey: Uint8Array,
  rootCaveats: Caveat[],
  attenuations: Caveat[][],
  opts: { sealed: boolean },
): ParsedToken {
  let token = mintRoot(rootSecretKey, { caveats: rootCaveats });
  for (const caveats of attenuations) {
    token = attenuate(token, { caveats });
  }
  return opts.sealed ? seal(token) : token;
}

/** Fetches the mint service's real, signed revocation list (GET /revocations) and verifies
 * it (@adc/revocation's own createRevocationClient, polled once rather than left running in
 * the background — a scripted scenario run is short-lived and doesn't need a live poll
 * loop). Returns an empty set (not null) if the mint service holds no revocations yet, or
 * throws if the fetched list fails signature/freshness verification — a scenario never
 * silently treats "couldn't get the list" as "nothing is revoked." */
export async function fetchRevokedHashes(
  mintBaseUrl: string,
  rootPublicKey: Uint8Array,
): Promise<ReadonlySet<string>> {
  const client = createRevocationClient({
    url: new URL("/revocations", mintBaseUrl).toString(),
    rootPublicKey,
  });
  await client.poll();
  const hashes = client.getRevokedHashes();
  if (hashes === null) {
    throw new Error(
      "fetchRevokedHashes: revocation list unavailable or failed verification",
    );
  }
  return hashes;
}

// ---- adc-graph bridge: real @adc/graph events -> Principal-Graph's real, but
// independently-guessed, createAdcGraphSink() consumer ----
//
// See taxonomy/gaps/principal-graph.yaml's adc-graph-sink-event-shape-drift row: this
// bridge is the field-name translation neither project ships, confirmed necessary by
// reading both real sources side by side in this range. It does NOT fix the confirmed
// kind:'agent' hardcoding inside Principal-Graph's own handle() (that lives in the
// sibling project's own source, out of scope to patch here) — a mint event's real
// principal.kind ('service', per @adc/graph's rootKeyPrincipal()) is still recorded in
// Principal-Graph as kind:'agent' once this bridge hands it off; see that GAPS row for
// why this range reports the residual rather than silently working around it by
// bypassing Principal-Graph's own shipped function.

/** The real @adc/graph GraphEvent shape, as JSON (Date -> ISO string via JSON.stringify's
 * own Date.prototype.toJSON, per createNdjsonGraphSink's own doc comment). */
interface RealGraphEventJson {
  occurredAt: string;
  principal: {
    kind: "human" | "agent" | "service";
    source: string;
    externalId: string;
    displayName?: string | null;
  };
  onBehalfOf: {
    kind: "human" | "agent" | "service";
    source: string;
    externalId: string;
    displayName?: string | null;
  } | null;
  resource: {
    kind: string;
    source: string;
    externalId: string;
    displayName?: string | null;
  };
  action: string;
  decision: "allow" | "deny";
  denyReason: string | null;
  taintLabels: readonly string[];
  reversible: boolean | null;
  requestDigest: string | null;
}

function isAdcGraphAction(
  action: string,
): action is "mint" | "attenuate" | "seal" | "verify" | "revoke" {
  return (
    action === "mint" ||
    action === "attenuate" ||
    action === "seal" ||
    action === "verify" ||
    action === "revoke"
  );
}

/** Translates one real, on-the-wire @adc/graph GraphEvent into the AdcGraphEvent shape
 * Principal-Graph's own createAdcGraphSink() actually expects — the missing piece both
 * projects' own docs disclose as unconfirmed (see this file's module doc comment). */
export function translateGraphEventToPrincipalGraph(real: RealGraphEventJson): {
  action: "mint" | "attenuate" | "seal" | "verify" | "revoke";
  blockId: string;
  at: number;
  agent: { source: string; externalId: string; displayName?: string | null };
  onBehalfOf?: {
    source: string;
    externalId: string;
    displayName?: string | null;
  };
  outcome?: "allow" | "deny";
  reason?: string | null;
  digest?: string | null;
} {
  if (!isAdcGraphAction(real.action)) {
    throw new Error(
      `translateGraphEventToPrincipalGraph: unrecognized action "${real.action}"`,
    );
  }
  return {
    action: real.action,
    blockId: real.resource.externalId,
    at: Date.parse(real.occurredAt),
    agent: {
      source: real.principal.source,
      externalId: real.principal.externalId,
      displayName: real.principal.displayName,
    },
    onBehalfOf: real.onBehalfOf
      ? {
          source: real.onBehalfOf.source,
          externalId: real.onBehalfOf.externalId,
          displayName: real.onBehalfOf.displayName,
        }
      : undefined,
    outcome: real.action === "verify" ? real.decision : undefined,
    reason: real.denyReason,
    digest: real.requestDigest,
  };
}

/** Reads every NDJSON line appended to the mint service's MINT_GRAPH_EVENTS_PATH file
 * since `sinceByteOffset`, returning the parsed real GraphEvent JSON objects and the new
 * offset to resume from — a scripted scenario run reads the whole file fresh each time
 * rather than holding a live tail, since it runs to completion in one process. */
export function readNewGraphEvents(
  filePath: string,
  sinceByteOffset: number,
): { events: RealGraphEventJson[]; newOffset: number } {
  if (!existsSync(filePath)) return { events: [], newOffset: sinceByteOffset };
  const contents = readFileSync(filePath, "utf8");
  const buf = Buffer.from(contents, "utf8");
  const slice = buf.subarray(sinceByteOffset).toString("utf8");
  const events = slice
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RealGraphEventJson);
  return { events, newOffset: buf.length };
}

/** sha256 hex — matches @adc/core's own blockSignatureHash() input shape when a scenario
 * needs to name a block's revocation hash without having the raw signature bytes on hand
 * (e.g. when driving POST /revoke against a token minted via the HTTP mint path). */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function scenarioAdcCaveats(
  scenario: Scenario,
  tokenId: string,
): { rootCaveats: Caveat[]; attenuations: Caveat[][]; sealed: boolean } {
  const spec = scenario.stack.adcTokens.find((t) => t.id === tokenId);
  if (!spec)
    throw new Error(
      `scenario ${scenario.id}: no adcTokens entry named "${tokenId}"`,
    );
  if (spec.via !== "offline" || !spec.offline)
    throw new Error(
      `scenario ${scenario.id}: adcTokens["${tokenId}"] is not an offline token`,
    );
  return {
    rootCaveats: spec.offline.rootCaveats,
    attenuations: spec.offline.attenuations,
    sealed: spec.offline.sealed,
  };
}
