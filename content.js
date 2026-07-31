// content.js — runs on every page. Its only job is to report back the
// current text selection when the popup asks for it, so that "select text,
// then click the extension icon" works as a capture trigger.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "GET_SELECTION") {
    const selection = window.getSelection ? window.getSelection().toString() : "";
    sendResponse({ selection });
  }
  // No async work here, so we don't need to return true.
});
