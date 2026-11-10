// The Flow pages of the Miku window, by id (shell.ts draws the Notch ones
// from the island's settings).

import type { FlowPageRenderer, PageId } from "./shell";
import { homePage } from "./pages/home";
import { wardrobePage } from "./pages/wardrobe";
import { dictationPage } from "./pages/dictation";
import { notesPage } from "./pages/notes";
import { wordsPage } from "./pages/words";
import { stylesPage } from "./pages/styles";
import { settingsViewPage } from "./pages/flowsettings";
import { voicePage } from "./pages/voice";
import { mailBannedPage, mailOverviewPage, mailRulesPage, mailVIPPage } from "./pages/mail";

export const FLOW_PAGE_RENDERERS: Partial<Record<PageId, FlowPageRenderer>> = {
  home: homePage,
  wardrobe: wardrobePage,
  dictation: dictationPage,
  notes: notesPage,
  words: wordsPage,
  styles: stylesPage,
  settingsView: settingsViewPage,
  voice: voicePage,
  mailOverview: mailOverviewPage,
  mailRules: mailRulesPage,
  mailBanned: mailBannedPage,
  mailVIP: mailVIPPage,
};
