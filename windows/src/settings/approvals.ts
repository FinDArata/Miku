// Settings → Agents → Approvals: per tool, whether permission requests come to
// the island ("ask") or go through without asking ("always allow"). The same
// switch the approval card's Always button flips; "*" is every other tool.

import { withMode, type ApprovalMode, type ApprovalModes } from "../core/approval-modes";
import { anchor, row, segmented } from "../hub/ui";
import { h } from "../views/dom";
import { t } from "../i18n/i18n";

/** The tools the island sees by name, the ones worth their own row. */
export const APPROVAL_TOOLS = [
  "Bash",
  "PowerShell",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Read",
  "WebFetch",
  "WebSearch",
  "Glob",
  "Grep",
  "Task",
] as const;

/** The card itself; `onChange` persists (Bridge.approvalModesSet) and updates
 * the caller's copy. */
export function approvalsSection(modes: ApprovalModes, onChange: (modes: ApprovalModes) => void): HTMLElement {
  const body = h(
    "section",
    {},
    h("h2", {}, h("span", { text: t("Approvals") })),
    h("div", {
      class: "hint",
      text: t("Choose per tool whether Miku asks first. Always allow is standing consent: it holds while the island is paused, and the weekly recap still records it."),
    }),
  );
  const section = anchor("agents.approvals", body);

  const rows = h("div", { style: "display:flex;flex-direction:column;gap:4px" });
  const list: [string, string][] = [
    ...APPROVAL_TOOLS.map((tool) => [tool, tool] as [string, string]),
    ["*", t("Other tools")],
  ];
  for (const [key, title] of list) {
    const current: ApprovalMode = modes[key] === "always" ? "always" : "ask";
    rows.append(
      row(
        title,
        null,
        segmented<ApprovalMode>(
          [
            ["ask", t("Ask")],
            ["always", t("Always allow")],
          ],
          current,
          (v) => onChange(withMode(modes, key, v)),
        ),
      ),
    );
  }
  section.append(rows);
  return section;
}
