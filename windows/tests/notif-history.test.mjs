// The Notif page's history (src/island/history.ts): a chip per source, repeats
// from one sender stacked, and only a chat or an agent opens on a click.

import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom } from "./fakedom.mjs";

installFakeDom();

const H = await import("../src/island/history.ts");

const now = new Date(2026, 10, 22, 18, 0);
const at = (minAgo) => now.getTime() - minAgo * 60_000;
const e = (id, minAgo, kind, app, label, who, read = false) => ({ id, at: at(minAgo), kind, app, color: "#000", label, who, text: `m${id}`, read });

test("repeats from one sender in one day fold into a stack; anything between splits it", () => {
  const list = [
    e(1, 1, "chat", "line", "LINE", "Rin"),
    e(2, 2, "chat", "line", "LINE", "Rin"),
    e(3, 3, "chat", "line", "LINE", "Rin"),
    e(4, 4, "pc", "pc", "Outlook", "Dimas"),
    e(5, 5, "chat", "line", "LINE", "Rin"),
    e(6, 26 * 60, "chat", "line", "LINE", "Rin"),
  ];
  assert.deepEqual(H.stacks(list, now).map((s) => s.map((x) => x.id)), [[1, 2, 3], [4], [5], [6]]);
});

test("PC toasts count under their own app's name, all with app 'pc'", () => {
  assert.equal(H.sourceOf(e(1, 1, "pc", "pc", "Outlook", "x")), "pc:Outlook");
  assert.notEqual(H.sourceOf(e(1, 1, "pc", "pc", "Edge", "x")), H.sourceOf(e(2, 1, "pc", "pc", "Outlook", "x")));
  assert.equal(H.sourceOf(e(1, 1, "chat", "discord", "Discord", "x")), "discord");
});

test("only a chat or an agent opens; any other app's toast is just shown", () => {
  assert.ok(H.opens(e(1, 1, "chat", "line", "LINE", "Rin")));
  assert.ok(H.opens(e(1, 1, "chat", "discord", "Discord", "x")));
  assert.ok(H.opens(e(1, 1, "agent", "task-1", "Claude Code", "finished")));
  assert.ok(!H.opens(e(1, 1, "pc", "pc", "Outlook", "Dimas")));
  assert.ok(!H.opens(e(1, 1, "sistem", "miku", "Miku", "Update")));
});
