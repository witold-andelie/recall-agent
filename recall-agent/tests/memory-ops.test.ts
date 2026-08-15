import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeEntityName } from "../src/lib/memory/entities.ts";
import { mergeWorkingSet } from "../src/lib/memory/working.ts";
import { formatMemoriesForPrompt } from "../src/lib/memory/hybrid.ts";
import { formatToolResultsForModel } from "../src/lib/memory/agent-tools.ts";
import {
  DEFAULT_L2_SKIP,
  DEFAULT_L2_UPDATE,
  thresholdsFromCalibration,
} from "../src/lib/memory/thresholds.ts";
import { detectReplyLocale } from "../src/lib/language.ts";
import type { HybridHit } from "../src/lib/types.ts";

function hit(id: string, kind: HybridHit["kind"] = "fact"): HybridHit {
  return {
    id,
    user_id: "u",
    kind,
    content: id,
    importance: 0.5,
    hit_count: 0,
    last_used_at: null,
    created_at: "",
    updated_at: "",
    source_message_id: null,
    source_thread_id: null,
    score_vec: 0,
    score_txt: 0,
    score_recency: 0,
    score_usage: 0,
    hybrid_score: 0,
  };
}

test("normalizeEntityName collapses case and spaces", () => {
  assert.equal(normalizeEntityName("  Cockroach  DB "), "cockroach db");
});

test("mergeWorkingSet pins open work first and de-dupes", () => {
  const open = [hit("t1", "task_state")];
  const fused = [hit("t1", "task_state"), hit("f1")];
  const merged = mergeWorkingSet(fused, open);
  assert.equal(merged[0].id, "t1");
  assert.equal(merged.filter((m) => m.id === "t1").length, 1);
  assert.equal(merged.some((m) => m.id === "f1"), true);
});

test("formatMemoriesForPrompt empty path", () => {
  assert.match(formatMemoriesForPrompt([]), /No long-term/);
});

test("formatToolResultsForModel renders name and output", () => {
  const text = formatToolResultsForModel([
    { name: "search_memory", input: { query: "prefs" }, output: "none" },
  ]);
  assert.match(text, /search_memory/);
  assert.match(text, /none/);
});

test("thresholds stay default without enough labeled rows", () => {
  const t = thresholdsFromCalibration(
    {
      skip_n: 2,
      update_n: 0,
      add_n: 9,
      skip_p80: 0,
      update_p50: null,
      add_p20: 0.74,
    },
    "global",
  );
  assert.equal(t, null);
});

test("thresholds calibrate when each action has enough rows", () => {
  const t = thresholdsFromCalibration(
    {
      skip_n: 8,
      update_n: 8,
      add_n: 8,
      skip_p80: 0.2,
      update_p50: 0.5,
      add_p20: 0.8,
    },
    "global",
  );
  assert.ok(t);
  assert.ok(t!.l2Skip < t!.l2Update);
  assert.notEqual(t!.l2Skip, DEFAULT_L2_SKIP);
  assert.ok(t!.l2Update <= DEFAULT_L2_UPDATE + 0.5);
});

test("detectReplyLocale follows Spanish cues", () => {
  const loc = detectReplyLocale("hola gracias por la ayuda que puedes hacer");
  assert.equal(loc.tag, "es");
});
