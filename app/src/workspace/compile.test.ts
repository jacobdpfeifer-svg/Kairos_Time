import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileWorkspace as compileFromModule } from "../../../browser/scripts/lib/workspace/compile.mjs";
import { normalizeWorkflowDraft } from "../../../browser/scripts/lib/workspace/onboarding.mjs";
import { compileWorkspace } from "./compile";
import { apply, type Patch } from "./patch";
import type { WorkspaceSpec } from "./contracts";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../browser/tests/fixtures/workspace");

function emptyProposed(): WorkspaceSpec {
  return {
    schema_version: 1,
    status: "proposed",
    surfaces: {
      today: { slots: [] },
      week: { slots: [] },
      courses: { slots: [] },
      study: { slots: [] },
      advisor: { slots: [] },
    },
    blocks: {},
  };
}

function compileFixture(id: string) {
  const fixture = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), "utf8")) as {
    now: string;
    sessionId: string;
    input: unknown;
  };
  const draft = normalizeWorkflowDraft(fixture.input, { now: fixture.now, sessionId: fixture.sessionId });
  return { fixture, draft, result: compileWorkspace(draft, { now: fixture.now }) };
}

describe("workspace compile parity", () => {
  const ids = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json") && !name.endsWith(".golden.json"))
    .map((name) => name.replace(/\.json$/, ""))
    .sort();

  it("uses the same function the browser compiler exports", () => {
    expect(compileWorkspace).toBe(compileFromModule);
  });

  for (const id of ids) {
    it(`matches the ${id} golden and replays its patches`, () => {
      const { draft, fixture, result } = compileFixture(id);
      const golden = JSON.parse(fs.readFileSync(path.join(dir, `${id}.golden.json`), "utf8"));
      expect(result).toEqual(golden);
      expect(compileFromModule(draft, { now: fixture.now })).toEqual(result);

      let spec = emptyProposed();
      for (const patch of result.patches) {
        const applied = apply(spec, patch as Patch);
        expect(applied.ok, applied.ok ? "" : applied.error).toBe(true);
        if (applied.ok) spec = applied.spec;
      }
      expect(spec.blocks).toEqual(result.spec.blocks);
      expect(spec.surfaces).toEqual(result.spec.surfaces);
      expect(spec.density).toEqual(result.spec.density);
      expect(spec.home).toEqual(result.spec.home);
      expect(spec.quiet).toEqual(result.spec.quiet);
      expect(spec.requested_integrations).toBeUndefined();
      expect(spec.origin).toBeUndefined();
      expect(result.spec.origin?.kind).toBe("interview");
      expect(result.spec.status).toBe("proposed");
    });
  }
});
