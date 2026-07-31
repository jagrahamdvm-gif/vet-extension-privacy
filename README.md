# Vet Patient Capture — v0.3 scaffold

Chrome extension (Manifest V3) that captures patient data from web pages
(scribe apps, web-based PIMS, or any other page) via paste, image upload, or
text selection, then tags it with patient/doctor/date/intended-use before
queuing it for later use.

## Checking if a machine is out of date

The extension's version number lives in `manifest.json` and shows on its
card at `chrome://extensions`. If you're syncing this folder across
multiple machines (e.g. via Google Drive), compare the version shown on
that card to the `"version"` field in `manifest.json` on disk — if they
don't match, the sync hasn't finished or the extension hasn't been
reloaded yet on that machine. Hit the reload icon on the card after
confirming the folder is fully synced.

## Load it in Chrome

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this `vet-extension` folder
5. Pin the extension (puzzle-piece icon in the toolbar → pin "Vet Capture")

## What's in this scaffold

- **Capture triggers**
  - Right-click selected text on any page → "Capture selection to Vet
    Extension" → lands in the popup's "Needs tagging" queue with a badge
    count on the toolbar icon.
  - Select text, then click the toolbar icon → the popup auto-fills the
    paste box with your selection.
  - Paste text directly into the popup, or upload an image, at any time.
- **Tagging**: every capture gets patient first/last, doctor first/last,
  date, and an intended-use dropdown (referral letter, reference lab
  history, radiology review, other) before it counts as "captured."
- **Queue**: tagged captures persist in `chrome.storage.local` and show in
  the "Captured" list. Each has Edit / Copy (or Download, for files) /
  Send → Desktop / Send → Browser / Delete actions.
- **Send to Claude**: formats a capture's metadata (patient, doctor, date,
  intended use) plus the full document-generation instructions for that
  intended use (referral letter, SOAP exam record, or lab/radiology
  summary — mirroring what the practice's existing Claude chat has been
  configured with) into one self-contained prompt, so it works with any
  capable AI tool, not just a pre-configured chat. Then either:
  - **Send → Desktop**: opens Claude Desktop directly via a `claude://`
    deep link with the prompt pre-filled, ready to review and send.
    Requires Claude Desktop to be installed; if it isn't, nothing will
    happen (the OS won't have a handler registered for `claude://`).
  - **Send → Browser**: copies the same prompt to your clipboard and opens
    a new `claude.ai` tab, so you paste and send manually. This works on
    any machine regardless of whether Claude Desktop is installed —
    Anthropic removed the old browser URL-prefill parameter for security
    reasons, so a manual paste is currently the only way to hand off text
    to the web app.
  - For image/file captures, only the metadata gets carried over
    automatically — the file itself has to be attached manually in the
    Claude chat, since neither delivery method can carry a file through.
- **Storage**: everything lives locally in the browser
  (`chrome.storage.local`) — nothing is sent anywhere yet. Where captures
  should ultimately live (local-only vs. synced to a backend) is still
  undecided, so this scaffold keeps it local and simple on purpose.

## Not built yet (by design — later steps)

- Automatic Cornerstone/screen capture (that's the local helper app, out of
  scope for the extension itself)
- PDF generation from a capture (e.g. an actual referral letter) — the
  "Copy" action currently just copies raw captured text; wiring that into a
  generated document is a separate step
- Safari build (Chrome first, per your call)
- Any actual Claude/tool integration — right now this only catalogs and
  tags data locally

## Files

```
manifest.json    Extension config (Manifest V3)
background.js    Right-click context menu + badge count for untagged items
content.js       Reports the page's current text selection to the popup
popup.html/.css/.js   Main UI: capture, tag, queue, copy/download, send to Claude
icons/           Placeholder icons (16/48/128px)
```

## Changelog

- **0.3.0** — Added a "previously used doctor" dropdown (separate from the
  single default-doctor shortcut) populated automatically from past
  captures; Send-to-Claude prompts now include the full document-generation
  instructions per intended use (referral letter, SOAP exam record, lab
  history/radiology review) so the prompt is self-contained for any AI
  tool, not dependent on a pre-configured chat.
- **0.2.0** — Default doctor auto-fill; file upload now accepts any file
  type (not just images); added Send → Desktop (Claude Desktop deep link)
  and Send → Browser (copy + open claude.ai) actions per capture.
- **0.1.0** — Initial scaffold: capture (paste/upload/selection/right-click),
  tag, local queue, copy/download/edit/delete.
