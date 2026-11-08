// Home: what Miku is doing right now, one card per thing, and the way into
// each page. The window opens here.
//
// The cards read the same sources their pages do (the hooks of the agents,
// the keys in the credential store, the chat's model), so Home never claims
// something the page behind it would contradict.

import { h } from "../../views/dom";
import { t } from "../../i18n/i18n";
import { Bridge } from "../../core/bridge";
import { flowKeyId } from "../../core/flow";
import { activeModel, providerDef } from "../../core/providers";
import { State } from "../../core/state";
import { parseVariant, resolveVariant, VARIANT_KEYS } from "../../mochi/wardrobe";
import { storedSkin } from "../../theme/sync";
import type { HubContext, PageId } from "../shell";
import { icon, keyLabel } from "../ui";

/** The integrations asked for a key, and the colour each is known by. */
const SERVICES: { name: string; key: string; color: string }[] = [
  { name: "Stripe", key: "stripe-api-key", color: "#0570DE" },
  { name: "GitHub", key: "github-token", color: "#F4505E" },
  { name: "GitLab", key: "gitlab-token", color: "#FC6D26" },
  { name: "Gitea", key: "gitea-token", color: "#609926" },
  { name: "Vercel", key: "vercel-token", color: "#7C5CFF" },
  { name: "n8n", key: "n8n-api-key", color: "#F29B38" },
  { name: "Resend", key: "resend-api-key", color: "#22C55E" },
  { name: "Notion", key: "notion-api-key", color: "#8C8C8C" },
  { name: "Cal.com", key: "calcom-api-key", color: "#C9956A" },
];

/** "#39c5bb" → "rgba(57, 197, 187, a)". */
function tint(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

interface CardOptions {
  icon: string;
  name: string;
  state: string;
  hint: string;
  page: PageId;
  color?: string;
  /** Colour dots for the integrations that answered. */
  swatches?: { name: string; color: string }[];
}

function homeCard(ctx: HubContext, opts: CardOptions): HTMLElement {
  const el = h("button", { class: "hub-home-card", onclick: () => ctx.navigate(opts.page) }) as HTMLButtonElement;
  if (opts.color) {
    el.style.setProperty("--card-color", opts.color);
    el.style.setProperty("--card-tint", tint(opts.color, 0.1));
    el.style.setProperty("--card-line", tint(opts.color, 0.4));
  }
  const top = h("div", { class: "top" },
    h("span", { class: "tile" }, icon(opts.icon)),
    h("span", { class: "name", text: opts.name }),
  );
  el.append(top, h("div", { class: "state", text: opts.state }), h("div", { class: "hint", text: opts.hint }));
  if (opts.swatches?.length) {
    const row = h("div", { class: "swatches" });
    for (const s of opts.swatches.slice(0, 6)) {
      const dot = h("span", { class: "swatch", title: s.name });
      dot.style.color = s.color;
      dot.style.background = s.color;
      row.append(dot);
    }
    if (opts.swatches.length > 6) row.append(h("span", { class: "more", text: `+${opts.swatches.length - 6}` }));
    el.append(row);
  }
  el.append(h("div", { class: "go", text: t("Open") }));
  return el;
}

export async function homePage(page: HTMLElement, ctx: HubContext) {
  const status = ctx.status;
  const settings = State.settings;
  const key = keyLabel(status.keys === "wayland" ? "wayland" : flowKeyId(status.prefs), status.platform);
  const modelReady = status.models.parakeet.state === "ready";

  page.append(ctx.hero("home", t("Home"), t("Everything Miku is doing, at a glance.")));

  // The key that starts dictation, under the band.
  page.append(h("div", { class: "hub-home-quick" },
    h("span", { class: "hub-keycap", text: key }),
    h("span", { class: "hub-note", text: t("Dictate anywhere on your computer") }),
  ));

  const [hooks, agents, connected] = await Promise.all([
    Bridge.hooksStatus(),
    Bridge.agentHooksList(),
    Promise.all(SERVICES.map(async (s) => ({ ...s, on: (await Bridge.secretPresent(s.key)) ?? false }))),
  ]);

  const claude = hooks?.installed ?? false;
  const installedAgents = agents?.filter((a) => a.installed) ?? [];
  const agentCount = installedAgents.length + (claude ? 1 : 0);
  const agentNames = [...(claude ? ["Claude Code"] : []), ...installedAgents.map((a) => a.name)];
  const services = connected.filter((s) => s.on);
  const model = activeModel(settings);
  const provider = providerDef(settings.chatProvider);

  const grid = h("div", { class: "hub-home" });
  // The skin in force: "auto" says which one that is today, not the word.
  const selection = parseVariant(State.settings.mikuVariant);
  const skin = storedSkin();
  const skinLabel = selection === "auto"
    ? t("Auto · {variant}", { variant: t(VARIANT_KEYS[resolveVariant(selection, new Date())]) })
    : t(VARIANT_KEYS[selection]);
  grid.append(
    homeCard(ctx, {
      icon: "star",
      name: t("Skin"),
      color: skin.accent,
      state: skinLabel,
      hint: t("The window, the pill and Miku all wear this skin."),
      page: "wardrobe",
    }),
    homeCard(ctx, {
      icon: "mic",
      name: t("Dictation"),
      color: "#FB923C",
      state: !status.prefs.enabled ? t("Off") : modelReady ? t("Ready") : t("Setup needed"),
      hint: !status.prefs.enabled
        ? t("Dictation is off")
        : modelReady
          ? t("Hold {0} in any app, speak, let go: your words are pasted where you type.", { 0: key })
          : t("Download the voice model to dictate"),
      page: "dictation",
    }),
    homeCard(ctx, {
      icon: "terminal",
      name: t("Agents"),
      color: "#4FA8FF",
      state: agentCount > 0 ? t("{0} active", { 0: agentCount }) : t("None yet"),
      hint: agentNames.length ? agentNames.join(", ") : t("Claude Code, Codex and the other agents Miku follows."),
      page: "agents",
    }),
    homeCard(ctx, {
      icon: "puzzle",
      name: t("Integrations"),
      color: "#7C8CFF",
      state: services.length > 0 ? t("{0} connected", { 0: services.length }) : t("None yet"),
      hint: t("Stripe, GitHub, Vercel, n8n, Notion and the rest."),
      swatches: services,
      page: "integrations",
    }),
    homeCard(ctx, {
      icon: "chat",
      name: t("Chat"),
      color: provider.accent,
      state: model || t("Not set up"),
      hint: `${provider.name} · ${t("The AI of the island's chat, with your own keys.")}`,
      page: "chat",
    }),
    homeCard(ctx, {
      icon: "wave",
      name: "OK Miku",
      color: "#39C5BB",
      state: status.prefs.voice ? t("Ready") : t("Off"),
      hint: t("Talk to Miku instead of typing."),
      page: "voice",
    }),
  );
  page.append(grid);
}
