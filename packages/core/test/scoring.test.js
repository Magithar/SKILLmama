import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreCandidate } from "../dist/index.js";

const CANDIDATE = {
  name: "test-candidate",
  tier: "package-registry",
  url: "https://example.com/test-candidate",
};

const factors = (compatibility, popularity, maintenance, simplicity) => ({
  compatibility,
  popularity,
  maintenance,
  simplicity,
});

// 1. Weights — the formula is compatibility*0.40 + popularity*0.30 +
// maintenance*0.15 + simplicity*0.15, pinned exactly.
test("all-10 factors total 10", () => {
  const score = scoreCandidate(CANDIDATE, factors(10, 10, 10, 10));
  assert.equal(score.totalScore, 10);
});

test("all-1 factors total 1", () => {
  const score = scoreCandidate(CANDIDATE, factors(1, 1, 1, 1));
  assert.equal(score.totalScore, 1);
});

test("known mix: (10,5,5,5) = 4.0+1.5+0.75+0.75 = 7", () => {
  const score = scoreCandidate(CANDIDATE, factors(10, 5, 5, 5));
  assert.equal(score.totalScore, 7);
});

// Weight checks assert absolute pinned totals (not deltas between rounded
// totals — a 0.15 bump does not survive 1-decimal rounding as 0.15).
test("compatibility carries weight 0.40: (6,5,5,5) = 5.4", () => {
  const score = scoreCandidate(CANDIDATE, factors(6, 5, 5, 5));
  assert.equal(score.totalScore, 5.4);
});

test("popularity carries weight 0.30: (5,6,5,5) = 5.3", () => {
  const score = scoreCandidate(CANDIDATE, factors(5, 6, 5, 5));
  assert.equal(score.totalScore, 5.3);
});

test("maintenance and simplicity each carry weight 0.15: (5,5,6,5) = (5,5,5,6) = 5.2", () => {
  // Exact sum is 5.15; the half-up convention renders it 5.2.
  assert.equal(scoreCandidate(CANDIDATE, factors(5, 5, 6, 5)).totalScore, 5.2);
  assert.equal(scoreCandidate(CANDIDATE, factors(5, 5, 5, 6)).totalScore, 5.2);
});

test("boundary totals snap before rounding: exact .x5 always rounds half-up, never FP-random", () => {
  // (7,8,9,9) sums to 7.899999999999999 in floating point; must render 7.9.
  assert.equal(scoreCandidate(CANDIDATE, factors(7, 8, 9, 9)).totalScore, 7.9);
});

// 2. Rounding — totals render as X.X in Phase 5; the function pins that
// convention so output is byte-stable across runs.
test("repeating decimal rounds to one decimal place", () => {
  // (8*0.4 + 6*0.3 + 7*0.15) / 0.85 = 6.05/0.85 = 7.11764... -> 7.1
  const score = scoreCandidate(CANDIDATE, factors(8, 6, 7, "N/A"));
  assert.equal(score.totalScore, 7.1);
});

// 3. N/A renormalization — SKILL.md Phase 4: "If a field is unknown, mark
// it N/A and weight the remaining factors proportionally."
test("single N/A renormalizes: (10,10,N/A,10) = 8.5/0.85 = 10", () => {
  const score = scoreCandidate(CANDIDATE, factors(10, 10, "N/A", 10));
  assert.equal(score.totalScore, 10);
});

test("single N/A renormalizes non-trivially: (5,5,N/A,5) = 4.25/0.85 = 5", () => {
  const score = scoreCandidate(CANDIDATE, factors(5, 5, "N/A", 5));
  assert.equal(score.totalScore, 5);
});

test("two N/A factors renormalize across surviving weights", () => {
  // (6*0.4 + 8*0.15) / 0.55 = 3.6/0.55 = 6.5454... -> 6.5
  const score = scoreCandidate(CANDIDATE, factors(6, "N/A", "N/A", 8));
  assert.equal(score.totalScore, 6.5);
});

test("all factors N/A yields totalScore N/A, never a number", () => {
  const score = scoreCandidate(CANDIDATE, factors("N/A", "N/A", "N/A", "N/A"));
  assert.equal(score.totalScore, "N/A");
});

test("renormalization records notes; fully-weighted scores carry none", () => {
  const clean = scoreCandidate(CANDIDATE, factors(10, 10, 10, 10));
  assert.equal(clean.notes, undefined);

  const renormed = scoreCandidate(CANDIDATE, factors(10, 10, "N/A", 10));
  assert.ok(Array.isArray(renormed.notes));
  assert.equal(renormed.notes.length, 1);
  assert.match(renormed.notes[0], /maintenance.*N\/A/);

  const allNA = scoreCandidate(CANDIDATE, factors("N/A", "N/A", "N/A", "N/A"));
  assert.ok(allNA.notes.length >= 1);
});

// 4. Validation — fail loudly instead of letting bad input into arithmetic.
test("factors below 1 throw", () => {
  assert.throws(() => scoreCandidate(CANDIDATE, factors(0, 5, 5, 5)), /compatibility/);
  assert.throws(() => scoreCandidate(CANDIDATE, factors(5, -3, 5, 5)), /popularity/);
});

test("factors above 10 throw", () => {
  assert.throws(() => scoreCandidate(CANDIDATE, factors(11, 5, 5, 5)), /compatibility/);
  assert.throws(() => scoreCandidate(CANDIDATE, factors(5, 5, 5, 99)), /simplicity/);
});

test("non-numeric garbage throws, naming the offending factor", () => {
  assert.throws(() => scoreCandidate(CANDIDATE, factors("7", 5, 5, 5)), /compatibility/);
  assert.throws(() => scoreCandidate(CANDIDATE, factors(5, NaN, 5, 5)), /popularity/);
  assert.throws(() => scoreCandidate(CANDIDATE, factors(5, 5, Infinity, 5)), /maintenance/);
  assert.throws(() => scoreCandidate(CANDIDATE, factors(5, 5, null, 5)), /maintenance/);
});

test("non-object candidate throws", () => {
  assert.throws(() => scoreCandidate(null, factors(5, 5, 5, 5)), /candidate/);
});

// 5. Output shape — inputs echoed verbatim, candidate attached.
test("result echoes candidate and all four factor values verbatim", () => {
  const input = factors(8, "N/A", 6, 9);
  const score = scoreCandidate(CANDIDATE, input);
  assert.deepEqual(score.candidate, CANDIDATE);
  assert.equal(score.compatibility, 8);
  assert.equal(score.popularity, "N/A");
  assert.equal(score.maintenance, 6);
  assert.equal(score.simplicity, 9);
});

// 6. Determinism — same input, byte-identical output.
test("same input produces deep-equal output across calls", () => {
  const a = scoreCandidate(CANDIDATE, factors(8, 6, "N/A", 9));
  const b = scoreCandidate(CANDIDATE, factors(8, 6, "N/A", 9));
  assert.deepEqual(a, b);
});
