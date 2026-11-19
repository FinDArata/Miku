import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { installFakeDom } from "./fakedom.mjs";

// The shell imports its stylesheet; layout is checked in the browser.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith(".css")) {
      return { url: new URL(specifier, context.parentURL).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true };
    return nextLoad(url, context);
  },
});

const dom = installFakeDom();
document.addEventListener = () => {};
document.documentElement = { dataset: {} };
window.addEventListener = () => {};
const { sectionOf } = await import("../src/hub/shell.ts");

test("a section id and each of its tab ids resolve to that section", () => {
  const cases = [
    ["notch", "notch", null],
    ["general", "notch", "general"],
    ["pills", "notch", "pills"],
    ["agents", "notch", "agents"],
    ["chat", "notch", "chat"],
    ["voice", "notch", "voice"],
    ["shortcuts", "notch", "shortcuts"],
    ["mail", "mail", null],
    ["mailRules", "mail", "mailRules"],
    ["settingsView", "settingsView", null],
    ["flowsettings", "settingsView", "flowsettings"],
    ["words", "words", null],
    ["notes", "notes", null],
    // Old ids that moved into a page still resolve to their host.
    ["dictionary", "words", null],
    ["snippets", "words", null],
    ["insights", "notes", null],
  ];
  for (const [id, sectionId, tabId] of cases) {
    const got = sectionOf(id);
    assert.equal(got.section.id, sectionId, id);
    assert.equal(got.tab ? got.tab.id : null, tabId, id);
  }
});
