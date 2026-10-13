import { test } from "node:test";
import assert from "node:assert/strict";
import { DOC_SECTIONS, ROADMAP, TREATMENTS } from "./publicContent";

test("docs cover the app and the NFT and token plans", () => {
  const ids = DOC_SECTIONS.map(section => section.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ["access", "invites", "profile", "posts", "feed", "discover",
    "subscriptions", "messages", "checkins", "daily-bonus", "points", "foot-spa",
    "badges", "nft", "token", "architecture", "safety", "privacy", "troubleshooting", "faq"]) {
    assert.ok(ids.includes(id), `Missing documentation for ${id}`);
  }
});

test("published copy does not contain dashes or underscores", () => {
  const copy = [
    ...DOC_SECTIONS.flatMap(s => [s.title, ...s.paras, ...(s.items ?? []).flatMap(i => [i.t, i.d])]),
    ...ROADMAP.flatMap(s => [s.title, s.when, s.status, ...s.points]),
    ...TREATMENTS.flatMap(t => [t.name, t.price, t.doubles, t.count, t.total, t.invite]),
  ];
  for (const text of copy) assert.doesNotMatch(text, /[-_\u2010-\u2015\u2212]/);
});

test("unreleased collection access and token milestones remain planned", () => {
  for (const id of ["opensea", "nft-access", "mfeet"]) {
    assert.equal(ROADMAP.find(stage => stage.id === id)?.status, "Planned");
  }
  assert.equal(ROADMAP.find(stage => stage.id === "testnet")?.status, "Completed");
  assert.equal(ROADMAP.find(stage => stage.id === "mainnet-app")?.status, "Current");
});
