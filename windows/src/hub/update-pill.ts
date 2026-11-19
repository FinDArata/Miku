// The Miku window's update pill: on the main menu (top right) and under her on
// the left column once a page is open. It says which version you have and
// checks on a click; when a newer one is out it lights up and installs it
// (Windows installs) or opens its release page, showing the download as it
// goes. Rust (src-tauri/src/update.rs) does all the work; nothing is asked of
// GitHub but on that click or under the consent given in the island.

import { Bridge, onEvent } from "../core/bridge";
import { NO_UPDATE, isBusy, percent, type UpdateStatus } from "../core/update";
import { h } from "../views/dom";
import { t } from "../i18n/i18n";

export function updatePill(version: string): HTMLElement {
  let status: UpdateStatus = { ...NO_UPDATE, current: version };
  const text = h("span", { class: "hub-update-text" });
  const button = h("button", { class: "hub-update-btn" }) as HTMLButtonElement;
  const el = h("div", { class: "hub-update", role: "status" }, text, button);

  button.addEventListener("click", async () => {
    if (status.latest) {
      if (status.canInstall) void Bridge.updateInstall();
      else void Bridge.updateOpenPage();
      return;
    }
    status = { ...status, check: "checking" };
    draw();
    const fresh = await Bridge.updateCheck();
    if (fresh) status = fresh;
    draw();
  });

  function draw() {
    const r = status.latest;
    const p = status.phase;
    el.classList.toggle("has", !!r);
    button.hidden = isBusy(p);
    button.disabled = status.check === "checking";
    if (r) {
      text.textContent = p.kind === "downloading" ? t("Downloading from GitHub… {percent} %", { percent: percent(p.fraction) })
        : p.kind === "verifying" ? t("Checking the download…")
          : p.kind === "installing" ? t("Installing… Miku closes and comes back by itself.")
            : p.kind === "error" ? t("The update didn't go through")
              : t("Miku {version} is out", { version: r.version });
      button.textContent = status.canInstall ? t("Update now") : t("Get it on GitHub");
      return;
    }
    text.textContent = status.check === "upToDate" ? t("Miku is up to date")
      : status.check === "unreachable" ? t("Couldn't reach GitHub")
        : t("You have {version}", { version: status.current || version });
    button.textContent = status.check === "checking" ? "…" : t("Check now");
  }

  void Bridge.updateStatus().then((fresh) => {
    if (fresh) status = fresh;
    draw();
  });
  void onEvent<UpdateStatus>("update-status", (fresh) => {
    status = fresh;
    draw();
  });
  draw();
  return el;
}
