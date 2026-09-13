import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  currentGraphEventsByteOffset,
  readNewGraphEvents,
} from "../src/adapters/adc.js";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ccr-adc-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("currentGraphEventsByteOffset", () => {
  it("returns 0 for a path that doesn't exist yet", () => {
    const path = join(tempDir(), "does-not-exist.ndjson");
    expect(currentGraphEventsByteOffset(path)).toBe(0);
  });

  it("returns the file's current byte length", () => {
    const path = join(tempDir(), "events.ndjson");
    writeFileSync(path, "hello", "utf8");
    expect(currentGraphEventsByteOffset(path)).toBe(5);
  });
});

describe("readNewGraphEvents", () => {
  it("returns zero events (and echoes the same offset back) when the path doesn't exist", () => {
    const path = join(tempDir(), "does-not-exist.ndjson");
    const result = readNewGraphEvents(path, 0);
    expect(result).toEqual({ events: [], newOffset: 0 });
  });

  it("reads only the NDJSON lines appended since the given offset", () => {
    const path = join(tempDir(), "events.ndjson");
    const first = {
      occurredAt: "2026-01-01T00:00:00.000Z",
      principal: { kind: "service", source: "adc-mint", externalId: "root" },
      onBehalfOf: null,
      resource: { kind: "block", source: "adc-mint", externalId: "b1" },
      action: "mint",
      decision: "allow",
      denyReason: null,
      taintLabels: [],
      reversible: null,
      requestDigest: null,
    };
    writeFileSync(path, JSON.stringify(first) + "\n", "utf8");
    const offsetAfterFirst = currentGraphEventsByteOffset(path);

    // Nothing new yet at this exact offset.
    expect(readNewGraphEvents(path, offsetAfterFirst).events).toEqual([]);

    const second = {
      ...first,
      resource: { ...first.resource, externalId: "b2" },
    };
    appendFileSync(path, JSON.stringify(second) + "\n", "utf8");

    const fromStart = readNewGraphEvents(path, 0);
    expect(fromStart.events).toHaveLength(2);

    const fromAfterFirst = readNewGraphEvents(path, offsetAfterFirst);
    expect(fromAfterFirst.events).toHaveLength(1);
    expect(fromAfterFirst.events[0]!.resource.externalId).toBe("b2");
  });
});
