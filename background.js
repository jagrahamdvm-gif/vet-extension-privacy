// background.js — Manifest V3 service worker
// Handles: right-click "capture selection" context menu, and keeping the
// toolbar badge in sync with how many captures still need patient/doctor/
// date/use tagged.

const STORAGE_KEY = "captures";
const MENU_ID = "vet-capture-selection";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Capture selection to Vet Extension',
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const text = (info.selectionText || "").trim();
  if (!text) return;

  const capture = {
    id: crypto.randomUUID(),
    tagged: false,
    patientFirst: "",
    patientLast: "",
    doctorFirst: "",
    doctorLast: "",
    date: "",
    intendedUse: "",
    text,
    files: [],
    sourceUrl: tab && tab.url ? tab.url : "",
    createdAt: Date.now(),
  };

  const data = await chrome.storage.local.get(STORAGE_KEY);
  const captures = data[STORAGE_KEY] || [];
  captures.unshift(capture);
  await chrome.storage.local.set({ [STORAGE_KEY]: captures });
});

async function refreshBadge() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const captures = data[STORAGE_KEY] || [];
  const untaggedCount = captures.filter((c) => !c.tagged).length;
  chrome.action.setBadgeText({ text: untaggedCount > 0 ? String(untaggedCount) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#144E54" });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) {
    refreshBadge();
  }
});

// Set badge correctly on browser startup / extension load.
refreshBadge();
