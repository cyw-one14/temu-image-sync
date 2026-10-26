"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../extension/core.js");
const a = { url: "https://img.kwcdn.com/product/a.jpg", width: 1080, height: 1440 };
const b = { url: "https://img.kwcdn.com/product/b.png", width: 770, height: 590 };

test("same draft keeps its identity across navigation tracking parameters", () => {
  const base = "https://agentseller.temu.com/goods/edit?productDraftId=123";
  assert.equal(core.getDraftKey(base + "&from=menu&st_time=1"), core.getDraftKey(base + "&st_time=2"));
  assert.notEqual(core.getDraftKey(base), core.getDraftKey(base.replace("123", "456")));
  for (const url of ["https://example.com/goods/edit?productDraftId=123", "https://agentseller.temu.com/goods/edit", "not a url"]) {
    assert.equal(core.getDraftKey(url), null);
  }
});

test("deduplication keeps source order and never mutates input", () => {
  const input = Object.freeze([Object.freeze(a), Object.freeze(b), { ...a, url: a.url + "?imageMogr2/thumbnail/100x" }]);
  const output = core.uniqueImages(input);
  assert.deepEqual(output.map(x => x.url), [a.url, b.url]);
  assert.equal(input.length, 3);
});

test("rejects non-CDN, local, insecure and credential-bearing image URLs", () => {
  for (const url of ["file:///C:/secret", "https://kwcdn.com.attacker.test/a.jpg", "http://img.kwcdn.com/a.jpg", "https://user:password@img.kwcdn.com/a.jpg", "javascript:alert(1)"]) {
    assert.equal(core.normalizeImage(url), null);
  }
});

test("an empty source waits instead of clearing existing detail images", () => {
  assert.equal(core.planSync({ source: [], detail: [b] }).action, "wait");
});

test("matching detail images are not inserted twice", () => {
  assert.equal(core.planSync({ source: [a, b], detail: [a, b] }).reason, "already-synced");
});

test("unowned detail images are protected, including reordered manual content", () => {
  assert.equal(core.planSync({ source: [a], detail: [b] }).action, "pause");
  const lastWritten = core.assetSignature([a, b]);
  assert.equal(core.planSync({ source: [a], detail: [b, a], lastWritten }).action, "pause");
});

test("the last unmodified plugin write can be updated in source order", () => {
  const lastWritten = core.assetSignature([a]);
  const plan = core.planSync({ source: [b, a], detail: [a], lastWritten });
  assert.equal(plan.action, "sync");
  assert.deepEqual(plan.images.map(x => x.url), [b.url, a.url]);
});

test("open user editor defers automatic synchronization", () => {
  assert.equal(core.planSync({ source: [a], editorBusy: true }).reason, "editor-busy");
});

test("asynchronous work from another draft or an old image list is cancelled", () => {
  const scope = new core.SyncScope();
  const old = scope.update("draft-1", [a]);
  assert.equal(scope.isCurrent(old), true);
  const changed = scope.update("draft-1", [b]);
  assert.equal(scope.isCurrent(old), false);
  assert.equal(scope.isCurrent(changed), true);
  const next = scope.update("draft-2", [b]);
  assert.equal(scope.isCurrent(changed), false);
  assert.equal(scope.isCurrent(next), true);
  scope.cancel();
  assert.equal(scope.isCurrent(next), false);
});

test("removing the draft identifier invalidates every pending upload", () => {
  const scope = new core.SyncScope();
  const ticket = scope.update("draft-1", [a]);
  scope.update(null, [a]);
  assert.equal(scope.isCurrent(ticket), false);
  assert.equal(scope.isCurrent(scope.ticket()), false);
});
