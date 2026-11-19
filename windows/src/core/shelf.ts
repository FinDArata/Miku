// The shelf: the files dropped on Miku, kept in the inbox for a week
// (src-tauri/src/files.rs). This keeps the last list the island read, the
// filter the Shelf page shows, and the small labels both the drop stage and the
// page draw. The list itself always comes from disk: nothing is stored here.

import { Bridge, type ShelfFile } from "./bridge";
import { State } from "./state";

export type ShelfKind = "docs" | "images" | "audio" | "code" | "other";
export type ShelfFilter = "all" | Exclude<ShelfKind, "other">;

const KINDS: Record<Exclude<ShelfKind, "other">, readonly string[]> = {
  docs: ["pdf", "doc", "docx", "odt", "rtf", "txt", "md", "xls", "xlsx", "ods", "csv", "ppt", "pptx", "odp", "epub"],
  images: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic", "avif", "tif", "tiff", "ico", "psd"],
  audio: ["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus", "mid", "midi", "vsqx", "vpr"],
  code: ["ts", "tsx", "js", "jsx", "mjs", "json", "rs", "py", "go", "java", "kt", "c", "h", "cpp", "cs", "rb", "php", "html", "css", "sh", "ps1", "toml", "yaml", "yml", "xml", "sql"],
};

/** Colour of a file's type tag, by kind (Miku pink for music). */
const KIND_COLOR: Record<ShelfKind, string> = {
  docs: "#E8697B",
  images: "#2FA9B0",
  audio: "#E12885",
  code: "#4A7BD0",
  other: "#7A8496",
};

/** The extension, upper-case, as the tag on the file shows it ("" for none). */
export function tagOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toUpperCase().slice(0, 4) : "";
}

export function kindOf(name: string): ShelfKind {
  const ext = tagOf(name).toLowerCase();
  for (const [kind, exts] of Object.entries(KINDS) as [Exclude<ShelfKind, "other">, readonly string[]][]) {
    if (exts.includes(ext)) return kind;
  }
  return "other";
}

export const colorOf = (name: string) => KIND_COLOR[kindOf(name)];

/** 240 KB, 1.2 MB, 3.4 GB — one decimal past a kilobyte. */
export function sizeLabel(bytes: number): string {
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** How long it has been on the shelf: 2m, 3h, 5d (the shelf keeps a week). */
export function ageLabel(added: number, now = Date.now()): string {
  const min = Math.max(0, Math.floor((now - added) / 60000));
  if (min < 60) return `${Math.max(1, min)}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function matches(file: { name: string }, filter: ShelfFilter): boolean {
  return filter === "all" || kindOf(file.name) === filter;
}

class ShelfStore {
  files: ShelfFile[] = [];
  filter: ShelfFilter = "all";
  /** "Clear all" asks once before it deletes (as the Notif page's clear does). */
  clearing = false;
  /** Rises when what the Shelf page draws changed: the deck's page key asks
   * for this instead of stringifying the whole file list on every sync. */
  private ver = 0;
  private loading: Promise<void> | null = null;
  private again = false;

  /** How many times the shelf's contents or clear state have changed (deck pageKey). */
  version(): number {
    return this.ver;
  }

  /** Reads the shelf again from disk (once more after a read already running: a file may have landed since). */
  refresh(): Promise<void> {
    if (this.loading) {
      this.again = true;
      return this.loading;
    }
    this.loading = Bridge.shelfList()
      .then((list) => {
        const next = list ?? [];
        // The same files as before: the page key stays put and the deck
        // skips the rebuild.
        if (!sameFiles(this.files, next)) this.ver++;
        this.files = next;
        State.notify();
      })
      .finally(() => {
        this.loading = null;
        if (this.again) {
          this.again = false;
          void this.refresh();
        }
      });
    return this.loading;
  }

  get totalBytes(): number {
    return this.files.reduce((s, f) => s + f.size, 0);
  }

  shown(): ShelfFile[] {
    return this.files.filter((f) => matches(f, this.filter));
  }

  setFilter(f: ShelfFilter) {
    this.filter = f;
    State.notify();
  }

  async remove(name: string) {
    this.files = this.files.filter((f) => f.name !== name);
    this.ver++;
    State.notify();
    await Bridge.shelfRemove(name);
    await this.refresh();
  }

  /** First call arms, second call clears: the copies are deleted from disk. */
  async clear() {
    if (!this.clearing) {
      this.clearing = true;
      this.ver++;
      State.notify();
      return;
    }
    this.clearing = false;
    this.files = [];
    this.ver++;
    State.notify();
    await Bridge.shelfClear();
    await this.refresh();
  }

  disarmClear() {
    if (!this.clearing) return;
    this.clearing = false;
    this.ver++;
    State.notify();
  }
}

/** Whether two shelf listings hold the same files, as the page shows them. */
function sameFiles(a: ShelfFile[], b: ShelfFile[]): boolean {
  return a.length === b.length && a.every((f, i) => {
    const o = b[i];
    return o.name === f.name && o.path === f.path && o.size === f.size && o.added === f.added;
  });
}

export const Shelf = new ShelfStore();
