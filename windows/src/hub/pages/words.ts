// Dictionary (names Miku always spells right, and replacements) and
// Snippets (say a short phrase, paste a whole text). Port of FlowHubWords.swift.

import { h, clear } from "../../views/dom";
import { t } from "../../i18n/i18n";
import { FlowBridge, type Replacement, type Snippet } from "../../core/flow";
import type { HubContext } from "../shell";
import { emptyState } from "../hero";
import { pageSave } from "../save";
import { button, card, icon, iconButton, label } from "../ui";

function newId(): string {
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 8)}`;
}

function input(placeholder: string, onEnter?: () => void): HTMLInputElement {
  const el = h("input", { class: "hub-input", placeholder }) as HTMLInputElement;
  if (onEnter) el.addEventListener("keydown", (e) => e.key === "Enter" && onEnter());
  return el;
}

async function dictionaryBody(page: HTMLElement) {
  const data = (await FlowBridge.words()) ?? { words: [], replacements: [] };
  let words = data.words;
  let replacements: Replacement[] = data.replacements;
  const write = pageSave(page);
  const save = async (next: typeof data) => {
    if (await write(() => FlowBridge.setWords(next)) !== "saved") return false;
    words = next.words;
    replacements = next.replacements;
    drawWords();
    drawReplacements();
    return true;
  };

  // ── Words ──
  const chips = h("div", { class: "hub-chips" });
  const wordInput = input(t("Add a word, e.g. Supabase"), () => addWord());
  const addWord = async () => {
    const w = wordInput.value.trim();
    if (!w || words.some((x) => x.toLowerCase() === w.toLowerCase())) return;
    if (await save({ words: [...words, w], replacements })) wordInput.value = "";
  };
  const drawWords = () => {
    clear(chips);
    if (words.length === 0) {
      chips.append(h("div", { class: "hub-note", text: t("No word yet. Add the names, brands and jargon Miku gets wrong.") }));
      return;
    }
    for (const w of words) {
      const remove = h("button", { title: t("Delete"), "aria-label": t("Delete") });
      remove.append(icon("x"));
      remove.addEventListener("click", () => {
        void save({ words: words.filter((x) => x !== w), replacements });
      });
      chips.append(h("span", { class: "hub-chip" }, h("span", { text: w }), remove));
    }
  };
  wordInput.style.flex = "1";
  const wordsCard = card(h("div", { class: "hub-row" }, wordInput, button(t("Add"), addWord, "primary")), chips);
  wordsCard.dataset.anchor = "flow.dictionary";
  page.append(wordsCard);
  drawWords();

  // ── Replacements ──
  page.append(label(t("Replacements")), h("div", { class: "hub-note", style: "margin-top:-10px", text: t("When Miku hears the words on the left, it writes the ones on the right.") }));
  const list = h("div", {});
  const from = input(t("Heard, e.g. cloud code"));
  const to = input(t("Written, e.g. Claude Code"), () => addReplacement());
  const addReplacement = async () => {
    const f = from.value.trim();
    const w = to.value.trim();
    if (!f || !w) return;
    if (await save({ words, replacements: [...replacements.filter((r) => r.from.toLowerCase() !== f.toLowerCase()), { id: newId(), from: f, to: w }] })) {
      from.value = "";
      to.value = "";
    }
  };
  const drawReplacements = () => {
    clear(list);
    for (const r of replacements) {
      list.append(h("div", { class: "hub-list-row" },
        h("div", { class: "grow hub-pair" },
          h("span", { text: r.from }),
          h("span", { class: "arrow", text: "→" }),
          h("b", { text: r.to, style: "font-weight:600" }),
          iconButton("trash", t("Delete"), () => {
            void save({ words, replacements: replacements.filter((x) => x.id !== r.id) });
          }),
        ),
      ));
    }
  };
  page.append(card(h("div", { class: "hub-pair" }, from, h("span", { class: "arrow", text: "→" }), to, button(t("Add"), addReplacement)), list));
  drawReplacements();
}

async function snippetsBody(page: HTMLElement) {
  let snippets: Snippet[] = (await FlowBridge.snippets()) ?? [];
  const write = pageSave(page);
  const save = async (next: Snippet[]) => {
    if (await write(() => FlowBridge.setSnippets(next)) !== "saved") return false;
    snippets = next;
    draw();
    return true;
  };

  let editing: Snippet | null = null;
  const formTitle = h("div", { style: "font:700 14px var(--font)" });
  const trigger = h("input", { class: "hub-input", placeholder: t("What you say, e.g. my signature") }) as HTMLInputElement;
  const text = h("textarea", { class: "hub-textarea", placeholder: t("The text Miku pastes") }) as HTMLTextAreaElement;
  const cancel = button(t("Cancel"), () => edit(null));
  const saveButton = button(t("Save"), async () => {
    const tr = trigger.value.trim();
    const tx = text.value;
    if (!tr || !tx.trim()) return;
    const next = editing
      ? snippets.map((s) => (s.id === editing!.id ? { ...s, trigger: tr, text: tx } : s))
      : [...snippets, { id: newId(), trigger: tr, text: tx }];
    if (await save(next)) edit(null);
  }, "primary");
  const edit = (s: Snippet | null) => {
    editing = s;
    formTitle.textContent = s ? t("Edit the snippet") : t("New snippet");
    trigger.value = s?.trigger ?? "";
    text.value = s?.text ?? "";
    cancel.style.display = s ? "" : "none";
  };
  page.append(card(formTitle, h("div", { class: "hub-row" }, h("span", { class: "hub-note", style: "width:80px", text: t("You say") }), trigger), text, h("div", { class: "hub-row", style: "justify-content:flex-end" }, cancel, saveButton)));
  trigger.style.flex = "1";
  edit(null);

  const list = h("div", {});
  const listCard = card(list);
  listCard.dataset.anchor = "flow.snippets";
  page.append(listCard);
  const draw = () => {
    clear(list);
    if (snippets.length === 0) {
      list.append(emptyState(t("No snippet yet. Your booking link, your signature, your address: say a few words, get the whole text."), "idle", "#F7B32B"));
      return;
    }
    for (const s of snippets) {
      list.append(h("div", { class: "hub-list-row" },
        h("div", { class: "grow" }, h("div", { style: "font:600 13.5px var(--font)", text: `« ${s.trigger} »` }), h("div", { class: "hub-snippet-text", text: s.text })),
        iconButton("pencil", t("Edit"), () => {
          edit(s);
          trigger.focus();
        }),
        iconButton("trash", t("Delete"), async () => {
          if (await save(snippets.filter((x) => x.id !== s.id)) && editing?.id === s.id) edit(null);
        }),
      ));
    }
  };
  draw();
}

/**
 * Words: the dictionary and the snippets, one band with a tab each. Both are
 * about the words Miku keeps for you — names it must spell right, and phrases
 * a trigger pastes whole — and each was a sidebar row of its own.
 */
export async function wordsPage(page: HTMLElement, ctx: HubContext) {
  page.append(ctx.hero("words", t("Words"), t("The words Miku knows, and the phrases a trigger types for you.")));
  const body = h("div", { class: "hub-page-body" });
  page.append(body);
  const tabs = h("div", { class: "hub-tabs" },
    h("button", { class: "hub-tab on", text: t("Dictionary") }),
    h("button", { class: "hub-tab", text: t("Snippets") }),
  );
  page.insertBefore(tabs, body);
  const [dictBtn, snipBtn] = [...tabs.querySelectorAll("button")] as HTMLButtonElement[];

  async function draw(which: "dictionary" | "snippets") {
    dictBtn.classList.toggle("on", which === "dictionary");
    snipBtn.classList.toggle("on", which === "snippets");
    clear(body);
    await (which === "dictionary" ? dictionaryBody(body) : snippetsBody(body));
  }
  dictBtn.addEventListener("click", () => void draw("dictionary"));
  snipBtn.addEventListener("click", () => void draw("snippets"));
  // A search hit for Snippets draws Words, so the tab it asked for has to be
  // the one that opens. `data-open-tab` is what the shell sets before drawing.
  const wanted = page.dataset.openTab ?? document.body.dataset.openTab;
  await draw(wanted === "snippets" ? "snippets" : "dictionary");
}

/**
 * The two halves on their own, with the band each had before they shared a
 * page. Kept as page renderers so a test (and a deep link to the old id) draws
 * exactly the dictionary or exactly the snippets.
 */
export async function dictionaryPage(page: HTMLElement, ctx: HubContext) {
  page.append(ctx.hero("dictionary", t("Dictionary"), t("Names and words Miku must always spell right.")));
  await dictionaryBody(page);
}

export async function snippetsPage(page: HTMLElement, ctx: HubContext) {
  page.append(ctx.hero("snippets", t("Snippets"), t("Say the trigger while dictating: Miku pastes the whole text in its place.")));
  await snippetsBody(page);
}
