// Island open/close FSM — port of IslandStateMachine.swift.
// No DOM, no Tauri: it only reports transitions.

export type FsmState = "hidden" | "petit" | "home" | "miku";

export class IslandStateMachine {
  state: FsmState = "hidden";

  onTransition: ((from: FsmState, to: FsmState) => void) | null = null;

  /**
   * home → petit delay, seconds: the auto-close preference. Changing it while a
   * countdown runs starts that countdown again with the new delay, so an edit in
   * Settings applies at once (IslandStateMachine.homeToPetitDelay on macOS).
   */
  get homeToPetitDelay(): number {
    return this.homeDelay;
  }
  set homeToPetitDelay(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds === this.homeDelay) return;
    this.homeDelay = seconds;
    if (this.state === "home" && this.homeCollapse != null) this.scheduleHomeCollapse();
  }
  /** petit → hidden delay, seconds. */
  petitToHiddenDelay = 60;
  /** miku → petit once the greeting animation ends (no hover). */
  greetAutoCollapseDelay = 0.6;
  /** miku → petit while the mouse hovers the greeting. */
  greetHoverCollapseDelay = 10;
  /** An alert waiting for an answer stays open, even when the mouse leaves. */
  pinned = false;
  /**
   * The compact island is showing something of its own that must not vanish on
   * a timer — the lyrics pill. While this is set the petit→hidden countdown does
   * not run, as if the pointer were still on the island. `lastActivity` is the
   * time it was last set, so a held-open island can still be told to fold after
   * a long quiet spell rather than staying for ever.
   */
  private held = false;
  /** Sets the hold; turning it on cancels a hide already counted down, turning
   *  it off starts a fresh countdown (the pill's own pause grace must survive
   *  the pointer leaving). */
  setHeldOpen(on: boolean) {
    if (this.held === on) return;
    this.held = on;
    if (on) this.clear("petitHide");
    else if (this.state === "petit" && !this.pinned) this.schedulePetitHide();
  }
  get heldOpen(): boolean {
    return this.held;
  }
  /**
   * Hovering opens the island all the way instead of peeking (Settings →
   * General → Open on hover, off by default), as IslandStateMachine.openOnHover.
   */
  openOnHover = false;
  /** Grace period after the pointer leaves a hover-opened island, seconds. */
  hoverCloseDelay = 0.6;
  /** How long the pointer rests on the compact island before Open on hover opens it, seconds. */
  hoverOpenDelay = 0.5;
  /** Open because of a hover, until the user clicks inside it. */
  get openedByHover(): boolean {
    return this.byHover;
  }

  /**
   * When the open island will fold, on the performance.now() clock, while the
   * mouse-leave countdown runs; null otherwise. The island draws its countdown
   * bar from it.
   */
  homeCollapseDueAt: number | null = null;

  private homeDelay = 15;
  private byHover = false;
  private petitHide: number | null = null;
  private homeCollapse: number | null = null;
  private greetCollapse: number | null = null;
  private hoverOpen: number | null = null;

  // ── Inputs ──────────────────────────────────────────────────────────────────

  launch() {
    this.cancelTimers();
    this.transition("miku");
  }

  mouseEntered() {
    switch (this.state) {
      case "hidden":
        // The closed island only peeks: a PC has no notch, so the pointer
        // lands on it far more often than on a Mac's, on its way elsewhere.
        this.cancelTimers();
        this.transition("petit");
        if (this.openOnHover && !this.pinned) this.scheduleHoverOpen();
        break;
      case "petit":
        this.clear("petitHide");
        // Open on hover: once the pointer rests on the compact island.
        if (this.openOnHover && !this.pinned) this.scheduleHoverOpen();
        break;
      case "home":
        this.clear("homeCollapse");
        break;
      case "miku":
        this.scheduleGreetCollapse(this.greetHoverCollapseDelay);
        break;
    }
  }

  mouseLeft() {
    this.clear("hoverOpen");
    switch (this.state) {
      case "hidden":
        break;
      case "petit":
        this.schedulePetitHide();
        break;
      case "home":
        this.scheduleHomeCollapse();
        break;
      case "miku":
        this.clear("greetCollapse");
        this.transition("petit");
        break;
    }
  }

  click() {
    this.byHover = false;
    if (this.state !== "petit") return;
    this.cancelTimers();
    this.transition("home");
  }

  /** Greeting animation finished (T.end). Doesn't override a running hover timer. */
  greetComplete() {
    if (this.state !== "miku") return;
    if (this.greetCollapse == null) this.scheduleGreetCollapse(this.greetAutoCollapseDelay);
  }

  /** Non-alert work event: show compact from hidden. */
  reveal() {
    if (this.state !== "hidden") return;
    this.cancelTimers();
    this.transition("petit");
    this.schedulePetitHide();
  }

  /**
   * The user clicked inside the island: a hover-opened island now stays like
   * any open island (normal auto-close) instead of folding once the pointer leaves.
   */
  userInteracted() {
    if (!this.byHover) return;
    this.byHover = false;
    // The short countdown already running becomes the normal one.
    if (this.state === "home" && this.homeCollapse != null) this.scheduleHomeCollapse();
  }

  /** Alert or explicit request: open straight to expanded. */
  forceHome() {
    this.byHover = false;
    this.cancelTimers();
    this.transition("home");
  }

  /// Explicit close (OK button, Escape, an alert being answered).
  forcePetit() {
    this.byHover = false;
    this.cancelTimers();
    this.transition("petit");
  }

  forceHidden() {
    this.byHover = false;
    this.cancelTimers();
    this.transition("hidden");
  }

  // ── Timers ──────────────────────────────────────────────────────────────────

  private schedulePetitHide() {
    this.clear("petitHide");
    // A card folded away while it waits for an answer keeps the compact island
    // on screen, so it can be reopened (isHeldOpen on macOS). So does the lyrics
    // pill: retracting the island would take the words with it.
    if (this.pinned || this.held) return;
    this.petitHide = window.setTimeout(() => {
      this.petitHide = null;
      if (this.state === "petit" && !this.pinned && !this.held) this.transition("hidden");
    }, this.petitToHiddenDelay * 1000);
  }

  private scheduleHomeCollapse() {
    this.clear("homeCollapse");
    if (this.pinned) return;
    const ms = (this.byHover ? this.hoverCloseDelay : this.homeDelay) * 1000;
    this.homeCollapseDueAt = performance.now() + ms;
    this.homeCollapse = window.setTimeout(() => {
      this.homeCollapse = null;
      this.homeCollapseDueAt = null;
      // An alert pinned while the countdown ran keeps the island open.
      if (this.state === "home" && !this.pinned) {
        this.byHover = false;
        this.transition("petit");
      }
    }, ms);
  }

  private scheduleHoverOpen() {
    this.clear("hoverOpen");
    this.hoverOpen = window.setTimeout(() => {
      this.hoverOpen = null;
      if (this.state !== "petit" || this.pinned || !this.openOnHover) return;
      this.cancelTimers();
      this.byHover = true;
      this.transition("home");
    }, this.hoverOpenDelay * 1000);
  }

  private scheduleGreetCollapse(delay: number) {
    this.clear("greetCollapse");
    this.greetCollapse = window.setTimeout(() => {
      this.greetCollapse = null;
      if (this.state === "miku") this.transition("petit");
    }, delay * 1000);
  }

  private clear(which: "petitHide" | "homeCollapse" | "greetCollapse" | "hoverOpen") {
    const id = this[which];
    if (id != null) window.clearTimeout(id);
    this[which] = null;
    if (which === "homeCollapse") this.homeCollapseDueAt = null;
  }

  /** Keeps the compact island visible while the lyrics pill owns it. */
  cancelPetitHide() {
    this.clear("petitHide");
  }

  cancelTimers() {
    this.clear("hoverOpen");
    this.clear("petitHide");
    this.clear("homeCollapse");
    this.clear("greetCollapse");
  }

  private transition(next: FsmState) {
    if (next === this.state) return;
    const from = this.state;
    this.state = next;
    this.onTransition?.(from, next);
  }
}
