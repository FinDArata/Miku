// A stand-in for Tauri in a plain browser, for the dev previews: every command
// answers from `answers` (or null), events can be fired with window.__emit.
// Not shipped in the app.
const listeners = new Map<string, (e: unknown) => void>();
const answers: Record<string, unknown> = (window as any).__answers ?? {};
let cb = 0;
(window as any).__TAURI_INTERNALS__ = {
  transformCallback: (callback: (e: unknown) => void) => {
    const id = ++cb;
    (window as any)[`_${id}`] = callback;
    return id;
  },
  invoke: async (cmd: string, args: any) => {
    if (cmd === "plugin:event|listen") {
      const fn = (window as any)[`_${args.handler}`] ?? args.handler;
      listeners.set(args.event, fn);
      return listeners.size;
    }
    if (cmd === "plugin:event|unlisten") return null;
    const a = answers[cmd];
    if (typeof a === "function") return (a as any)(args);
    return a ?? null;
  },
  metadata: { currentWindow: { label: "hub" }, currentWebview: { label: "hub", windowLabel: "hub" } },
};
(window as any).__emit = (event: string, payload: unknown) => listeners.get(event)?.({ event, id: 0, payload });

// Emulates the parked poll's glance (island.rs wake_if_hovered): while the
// island is folded, a `closed-hover` heartbeat repeats while the pointer is
// over the strip or the notice card, and stops the moment it leaves. Without
// it the folded-state hover logic (the notice hold) cannot run in a preview.
let cursor: { x: number; y: number } | null = null;
window.addEventListener("mousemove", (e) => {
  cursor = { x: e.clientX, y: e.clientY };
  // While the island is not folded the Rust poll would report the cursor
  // (island.rs spawn_cursor_poll): feed onCursor the page's own mouse.
  const mode = document.getElementById("island")?.dataset.mode;
  if (mode && mode !== "hidden") (window as any).__emit("cursor", { x: e.clientX, y: e.clientY });
});
window.addEventListener("mouseout", (e) => {
  if (e.relatedTarget == null) {
    cursor = null;
    const mode = document.getElementById("island")?.dataset.mode;
    if (mode && mode !== "hidden") (window as any).__emit("cursor", { x: -10000, y: -10000 });
  }
});
setInterval(() => {
  const island = document.getElementById("island");
  if (!island || island.dataset.mode !== "hidden" || !cursor) return;
  const over = (el: Element | null) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return cursor.x >= r.left && cursor.x <= r.right && cursor.y >= r.top && cursor.y <= r.bottom + 2;
  };
  if (over(island) || over(document.querySelector(".nt-card.on"))) (window as any).__emit("closed-hover");
}, 250);
