// What's new after an update — when the card opens. Once per version, a few
// seconds after Miku starts (after the greeting), and only when nothing
// waits in the island: a permission or a question always comes first, and
// another card the user is reading is never replaced. The rules are in
// whats-new.ts; the card is a notice (island/notices.ts).

import { Bridge, IS_TAURI } from "../core/bridge";
import { FlowBridge } from "../core/flow";
import { State } from "../core/state";
import { Updates } from "../island/update";
import {
  decideOnLaunch, releaseFor, releasePage, usedBefore,
  type WhatsNewFile, type WhatsNewRelease,
} from "./whats-new";

/** The changelog, read when the card may open: a 97 KB parse at every boot
 *  for a card seen once a version. */
let filePromise: Promise<WhatsNewFile> | null = null;
function file(): Promise<WhatsNewFile> {
  filePromise ??= import("./whats-new.json").then((m) => m.default as WhatsNewFile);
  return filePromise;
}

/** What the card needs from the island: the notice card (island/notices.ts). */
export interface WhatsNewHost {
  /** False when it cannot show now (the island is open, another card is up). */
  whatsNew(release: WhatsNewRelease, allChanges: () => void): boolean;
  /** The first-run hello. False when it cannot show now. */
  welcome(): boolean;
}

/** The last version this install saw. A convenience of this install, like the plan usage. */
const LAST_KEY = "miku.whatsNew.lastVersion";
/** The hello is shown once per install, whatever launches it takes. */
const WELCOME_KEY = "miku.welcome.shown";

/** After the greeting, so the two never meet; then every few seconds while the island is busy. */
const FIRST_DELAY_MS = 3000;
const RETRY_MS = 5000;
const RETRIES = 24;

function readLast(): string | null {
  try {
    return window.localStorage?.getItem(LAST_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeLast(version: string) {
  try {
    window.localStorage?.setItem(LAST_KEY, version);
  } catch {
    // Storage refused: the card may come once more, never more than that per launch.
  }
}

function readWelcome(): boolean {
  try {
    return window.localStorage?.getItem(WELCOME_KEY) != null;
  } catch {
    return false;
  }
}

function writeWelcome() {
  try {
    window.localStorage?.setItem(WELCOME_KEY, "1");
  } catch {
    // Storage refused: the hello may come again at the next launch.
  }
}

class WhatsNewController {
  /** The release the card shows (null: no card). */
  release: WhatsNewRelease | null = null;
  private host: WhatsNewHost | null = null;
  private started = false;

  /** At launch, once: show the card if Miku was just updated. */
  async launch(host: WhatsNewHost) {
    if (this.started) return;
    this.started = true;
    this.host = host;

    // `npm run dev` in a browser: ?welcome shows the first-run card, ?whats-new
    // the update card — styling both without a fresh install.
    if (!IS_TAURI) {
      if (location.search.includes("welcome")) {
        this.openWelcomeWhenQuiet(0);
        return;
      }
      if (!location.search.includes("whats-new")) return;
      const FILE = await file();
      const release = FILE.releases[0] ?? null;
      if (!release) return;
      this.prepare(release);
      this.openWhenQuiet(null, 0);
      return;
    }

    const current = Updates.status.current;
    const lastSeen = readLast();
    // Six launches out of seven this is all that runs.
    if (!current || lastSeen === current) return;

    const FILE = await file();
    const release = releaseFor(FILE, current);
    const [history, flow, notes] = await Promise.all([
      Bridge.recapHistory(0),
      FlowBridge.stats(),
      FlowBridge.notes(),
    ]);
    const firstRun = !usedBefore({
      consent: Updates.status.consent,
      history,
      dictations: flow?.all.dictations ?? 0,
      notes: notes?.notes.length ?? 0,
    });
    // A brand-new install gets the hello once — a changelog can wait, and
    // whats-new skips first installs anyway.
    if (firstRun && !readWelcome()) {
      this.openWelcomeWhenQuiet(0);
      return;
    }
    const decision = decideOnLaunch({
      current,
      lastSeen,
      usedBefore: firstRun,
      hasEntry: release != null,
    });
    if (!decision.show || !release) {
      if (decision.record) writeLast(current);
      return;
    }
    this.prepare(release);
    this.openWhenQuiet(current, 0);
  }

  private prepare(release: WhatsNewRelease) {
    this.release = release;
  }

  /** The hello, on the same "when quiet" clock as the whats-new card. */
  private openWelcomeWhenQuiet(attempt: number) {
    window.setTimeout(() => {
      if (State.paused || State.pendingApproval || !this.host?.welcome()) {
        if (attempt < RETRIES) this.openWelcomeWhenQuiet(attempt + 1);
        // Busy for two minutes: the next launch tries again.
        return;
      }
      writeWelcome();
    }, attempt === 0 ? FIRST_DELAY_MS : RETRY_MS);
  }

  private openWhenQuiet(version: string | null, attempt: number) {
    window.setTimeout(() => {
      const release = this.release;
      if (!release) return;
      if (State.paused || State.pendingApproval || !this.host?.whatsNew(release, () => this.openReleasePage(release.version))) {
        if (attempt < RETRIES) this.openWhenQuiet(version, attempt + 1);
        // Busy for two minutes: next launch, then (the version is not recorded).
        return;
      }
      if (version) writeLast(version);
    }, attempt === 0 ? FIRST_DELAY_MS : RETRY_MS);
  }

  /** "All changes": the release page of this version on GitHub. */
  private openReleasePage(version: string) {
    void Bridge.openUrl(releasePage(Updates.status.platform, version));
  }
}

export const WhatsNew = new WhatsNewController();
