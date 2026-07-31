// popup.js — all popup UI logic. Storage is the single source of truth;
// every render re-reads from chrome.storage.local so the popup, background
// script, and (eventually) the helper app all stay in sync.
//
// Capture schema:
// { id, tagged, patientFirst, patientLast, doctorFirst, doctorLast, date,
//   intendedUse, text, files: [{dataUrl, name, type}], createdAt, sourceUrl }
// `text` and `files` are independent — a capture can have either, both, or
// (transiently, before tagging) neither yet. `files` can hold any number of
// attachments.

const STORAGE_KEY = "captures";
const SETTINGS_KEY = "settings";
const DOCTOR_HISTORY_LIMIT = 20;

const els = {
  pendingSection: document.getElementById("pending-section"),
  pendingList: document.getElementById("pending-list"),
  capturedList: document.getElementById("captured-list"),
  capturedCount: document.getElementById("captured-count"),
  emptyState: document.getElementById("empty-state"),
  form: document.getElementById("capture-form"),
  formTitle: document.getElementById("form-title"),
  contentText: document.getElementById("content-text"),
  contentImage: document.getElementById("content-image"),
  filePreview: document.getElementById("file-preview"),
  patientFirst: document.getElementById("patient-first"),
  patientLast: document.getElementById("patient-last"),
  doctorFirst: document.getElementById("doctor-first"),
  doctorLast: document.getElementById("doctor-last"),
  doctorHistorySelect: document.getElementById("doctor-history-select"),
  date: document.getElementById("capture-date"),
  intendedUse: document.getElementById("intended-use"),
  clearBtn: document.getElementById("clear-form-btn"),
  setDefaultDoctorBtn: document.getElementById("set-default-doctor-btn"),
  clearDefaultDoctorBtn: document.getElementById("clear-default-doctor-btn"),
  defaultDoctorLabel: document.getElementById("default-doctor-label"),
  toast: document.getElementById("toast"),
};

let editingId = null; // id of the capture currently loaded into the form, if any
let pendingFiles = []; // [{ dataUrl, name, type }] — staged files for the current form
let toastTimer = null;

const USE_LABELS = {
  referral_letter: "Referral letter",
  soap_record: "SOAP-style exam record",
  lab_history: "Reference lab history",
  radiology_review: "Radiology review",
  other: "Other",
};

function migrateCapture(c) {
  // Normalizes older capture shapes into the current { text, files: [] }
  // shape so previously-saved data still renders and works.
  if (Array.isArray(c.files)) return c; // already current shape
  if (c.file !== undefined) {
    // 0.4.0 shape: single `file` object (or null)
    return { ...c, text: c.text || "", files: c.file ? [c.file] : [] };
  }
  if (c.sourceType === "text") {
    // pre-0.3 shape: sourceType/content
    return { ...c, text: c.content || "", files: [] };
  }
  if (c.sourceType) {
    return {
      ...c,
      text: "",
      files: [{ dataUrl: c.content, name: c.fileName || "", type: c.fileType || "" }],
    };
  }
  return { ...c, text: c.text || "", files: [] };
}

async function getCaptures() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return (data[STORAGE_KEY] || []).map(migrateCapture);
}

async function setCaptures(captures) {
  await chrome.storage.local.set({ [STORAGE_KEY]: captures });
}

async function getSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return data[SETTINGS_KEY] || {};
}

async function setSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

function fmtName(first, last) {
  const name = [first, last].filter(Boolean).join(" ");
  return name || "Unnamed";
}

function fmtSnippet(capture) {
  const parts = [];
  const text = (capture.text || "").trim();
  if (text) parts.push(text.replace(/\s+/g, " ").slice(0, 70));
  const files = capture.files || [];
  if (files.length === 1) parts.push(`[file: ${files[0].name || "unnamed"}]`);
  if (files.length > 1) parts.push(`[${files.length} files]`);
  return parts.join(" · ") || "(empty capture)";
}

function showToast(text) {
  els.toast.textContent = text;
  els.toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 2600);
}

async function render() {
  const captures = await getCaptures();
  const pending = captures.filter((c) => !c.tagged);
  const tagged = captures.filter((c) => c.tagged);

  els.pendingSection.classList.toggle("hidden", pending.length === 0);
  els.pendingList.innerHTML = "";
  for (const c of pending) {
    const li = document.createElement("li");
    li.className = "capture-card pending";
    li.innerHTML = `
      <div class="capture-top">
        <span class="tag-badge">Needs tagging</span>
        <span class="capture-meta">${new Date(c.createdAt).toLocaleString()}</span>
      </div>
      <p class="capture-snippet">${escapeHtml(fmtSnippet(c))}</p>
    `;
    li.addEventListener("click", () => loadIntoForm(c));
    els.pendingList.appendChild(li);
  }

  els.capturedCount.textContent = tagged.length ? `(${tagged.length})` : "";
  els.emptyState.classList.toggle("hidden", captures.length !== 0);
  els.capturedList.innerHTML = "";
  for (const c of tagged) {
    const li = document.createElement("li");
    li.className = "capture-card";
    const hasText = Boolean((c.text || "").trim());
    const fileCount = (c.files || []).length;
    const downloadLabel = fileCount > 1 ? `Download files (${fileCount})` : "Download file";
    li.innerHTML = `
      <div class="capture-top">
        <span class="capture-name">${escapeHtml(fmtName(c.patientFirst, c.patientLast))}</span>
        <span class="capture-meta">${escapeHtml(c.date || "")}</span>
      </div>
      <div class="capture-meta">${escapeHtml(USE_LABELS[c.intendedUse] || c.intendedUse || "")}${c.doctorFirst || c.doctorLast ? " · Dr. " + escapeHtml(fmtName(c.doctorFirst, c.doctorLast)) : ""}</div>
      <p class="capture-snippet">${escapeHtml(fmtSnippet(c))}</p>
      <div class="capture-actions">
        <button type="button" data-action="edit" class="btn-secondary">Edit</button>
        ${hasText ? '<button type="button" data-action="copy" class="btn-secondary">Copy text</button>' : ""}
        ${fileCount > 0 ? `<button type="button" data-action="download" class="btn-secondary">${downloadLabel}</button>` : ""}
        <button type="button" data-action="copy-prompt" class="btn-secondary">Copy prompt</button>
        <button type="button" data-action="send-desktop" class="btn-secondary">Send \u2192 Desktop</button>
        <button type="button" data-action="send-browser" class="btn-secondary">Send \u2192 Browser</button>
        <button type="button" data-action="delete" class="btn-secondary">Delete</button>
      </div>
    `;
    li.querySelector('[data-action="edit"]').addEventListener("click", () => loadIntoForm(c));
    li.querySelector('[data-action="delete"]').addEventListener("click", () => deleteCapture(c.id));
    li.querySelector('[data-action="copy-prompt"]').addEventListener("click", () => copyPrompt(c));
    li.querySelector('[data-action="send-desktop"]').addEventListener("click", () => sendToClaudeDesktop(c));
    li.querySelector('[data-action="send-browser"]').addEventListener("click", () => sendToClaudeBrowser(c));
    const copyBtn = li.querySelector('[data-action="copy"]');
    if (copyBtn) copyBtn.addEventListener("click", () => copyText(c));
    const downloadBtn = li.querySelector('[data-action="download"]');
    if (downloadBtn) downloadBtn.addEventListener("click", () => downloadFiles(c));
    els.capturedList.appendChild(li);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function loadIntoForm(capture) {
  editingId = capture.id;
  els.formTitle.textContent = capture.tagged ? "Edit capture" : "Tag capture";
  els.contentText.value = capture.text || "";

  pendingFiles = (capture.files || []).map((f) => ({ ...f }));
  renderFileChips();

  els.patientFirst.value = capture.patientFirst || "";
  els.patientLast.value = capture.patientLast || "";
  els.doctorFirst.value = capture.doctorFirst || "";
  els.doctorLast.value = capture.doctorLast || "";
  els.date.value = capture.date || todayStr();
  els.intendedUse.value = capture.intendedUse || "";
  els.form.scrollIntoView({ behavior: "smooth" });
}

function renderFileChips() {
  els.filePreview.innerHTML = "";
  els.filePreview.classList.toggle("hidden", pendingFiles.length === 0);

  pendingFiles.forEach((file, index) => {
    const chip = document.createElement("div");
    chip.className = "file-chip";
    const isImage = file.type && file.type.startsWith("image/");
    chip.innerHTML = `
      ${isImage
        ? `<img class="file-thumb" src="${file.dataUrl}" alt="">`
        : `<span class="file-icon">${fileIconFor(file.type)}</span>`}
      <span class="file-name">${escapeHtml(file.name || "Uploaded file")}</span>
      <button type="button" class="file-remove" data-index="${index}" title="Remove this file">\u00d7</button>
    `;
    chip.querySelector(".file-remove").addEventListener("click", () => {
      pendingFiles.splice(index, 1);
      renderFileChips();
    });
    els.filePreview.appendChild(chip);
  });
}

function fileIconFor(type) {
  if (!type) return "📄";
  if (type.startsWith("video/")) return "🎬";
  if (type === "application/pdf") return "📕";
  if (type.includes("word") || type.includes("document")) return "📝";
  if (type.startsWith("text/")) return "📃";
  return "📎";
}

async function resetForm() {
  editingId = null;
  pendingFiles = [];
  els.formTitle.textContent = "New capture";
  els.form.reset();
  els.contentImage.value = "";
  renderFileChips();
  els.date.value = todayStr();

  const settings = await getSettings();
  if (settings.defaultDoctorFirst || settings.defaultDoctorLast) {
    els.doctorFirst.value = settings.defaultDoctorFirst || "";
    els.doctorLast.value = settings.defaultDoctorLast || "";
  }
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

async function deleteCapture(id) {
  const captures = await getCaptures();
  await setCaptures(captures.filter((c) => c.id !== id));
  if (editingId === id) resetForm();
  render();
}

async function copyText(capture) {
  try {
    await navigator.clipboard.writeText(capture.text || "");
    showToast("Copied to clipboard");
  } catch (err) {
    console.error("Copy failed", err);
  }
}

function downloadFiles(capture) {
  const files = capture.files || [];
  if (files.length === 0) return;
  const namePart = fmtName(capture.patientFirst, capture.patientLast).replace(/\s+/g, "_");
  files.forEach((file, index) => {
    const a = document.createElement("a");
    a.href = file.dataUrl;
    const extMatch = (file.name || "").match(/\.[^.]+$/);
    const ext = extMatch ? extMatch[0] : "";
    const suffix = files.length > 1 ? `_${index + 1}` : "";
    a.download = `${namePart || "capture"}_${capture.date || todayStr()}${suffix}${ext}`;
    // Stagger downloads slightly — browsers can block near-simultaneous
    // multi-file downloads or prompt for permission on the first one.
    setTimeout(() => a.click(), index * 150);
  });
  if (files.length > 1) {
    showToast(`Downloading ${files.length} files — check for a browser permission prompt`);
  }
}

// --- Doctor history --------------------------------------------------------
// Tracks distinct doctors used across past captures so they can be picked
// from a dropdown instead of retyped, in addition to the single "default
// doctor" shortcut.

async function updateDoctorHistory(first, last) {
  first = (first || "").trim();
  last = (last || "").trim();
  if (!first && !last) return;

  const settings = await getSettings();
  const history = (settings.doctorHistory || []).filter(
    (d) => !(d.first.toLowerCase() === first.toLowerCase() && d.last.toLowerCase() === last.toLowerCase())
  );
  history.unshift({ first, last });
  await setSettings({ ...settings, doctorHistory: history.slice(0, DOCTOR_HISTORY_LIMIT) });
}

async function renderDoctorHistorySelect() {
  const settings = await getSettings();
  const history = settings.doctorHistory || [];
  els.doctorHistorySelect.innerHTML = '<option value="">— New doctor —</option>';
  for (const d of history) {
    const opt = document.createElement("option");
    opt.value = `${d.first}||${d.last}`;
    opt.textContent = fmtName(d.first, d.last);
    els.doctorHistorySelect.appendChild(opt);
  }
}

els.doctorHistorySelect.addEventListener("change", () => {
  const value = els.doctorHistorySelect.value;
  if (!value) return;
  const [first, last] = value.split("||");
  els.doctorFirst.value = first || "";
  els.doctorLast.value = last || "";
});

// --- Send to Claude ---------------------------------------------------------
// Builds a self-contained prompt — full generation instructions plus the
// capture's metadata and content — so any capable AI tool (not just a
// pre-configured Claude chat) can produce the requested document.

const STANDING_PREFERENCES = `STANDING PREFERENCES
- Signature on all veterinary records and referral letters: Choose veterinarian listed with full name followed by ,DVM and title Veterinarian 
- Referral letters address a single primary department team only (e.g. "Dear Oncology Team,") or a named specialist if specified — never multiple departments in one letter. The receiving hospital routes internally.
- Specialty/referral suggestions should cover the full Colorado Front Range (Colorado Springs to Fort Collins), matched to the patient's specific specialist need — not Denver Metro only prompt user for hospital selection
- Radiology review / reference lab sample submission documents (summarizing history and pertinent exam findings) are a DISTINCT document type from referral letters — do not conflate the two.`;

const TEMPLATE_REFERRAL_LETTER = `DOCUMENT TYPE: REFERRAL LETTER

Structure:
[Practice Name letterhead — bold, colored]
[Practice address | phone]
[Date]

[Addressee — specific specialist name+credentials if given, OR "Attn: (Department) Team"]
[Receiving practice name]
[Address, phone if available]

RE: Referral for [Patient Name] — [Species], [Sex/neuter status], [Age]

Dear [Department] Team, / Dear Dr. [Name],

[Opening paragraph — thank-you + one-sentence reason for referral]

History and Course
[Narrative paragraphs, chronological, drawn from visit history/comprehensive summary — surgery details, findings, complications if any]

Histopathology / Diagnostics (Lab, resulted [date])
[Bulleted key findings — grade, margins, mitotic count, vascular invasion, etc.]

Additional Relevant Findings [if applicable]
[Older/incidental labs relevant to current treatment or anesthesia planning]

Reason for Referral
[1 paragraph framing why + bulleted list of specific asks]

Enclosed / To Follow
[List of attached records]

Closing paragraph (brief, thank you)

Sincerely,
"Veterinrian name"
Park Hill Veterinary Medical Center
2255 Oneida Street, Denver, CO 80207 | (303) 388-2255

Deliver as a formatted document, suitable for conversion to PDF for visual QA before sending.`;

const TEMPLATE_SOAP_RECORD = `DOCUMENT TYPE: SOAP-STYLE EXAM RECORD

Structure:

History
  Signalment / Presenting Complaint / Patient History / Diet / Travel History / Medications / Supplements / Other Pets

Exam
  Vital Signs (Weight, Temp, HR, RR, MM, BCS, FAS)
  Findings (by body system: Eyes, Ears, Nose, Oral, Heart, Pulses, Lungs, MSK, Integument, Peripheral LN, Abdomen, Urogenital, Neuro, Rectal)

Assessment
  Problem List (with rule-outs)

Plan
  Plan / Client Consents / Prognosis / Diagnostics / Treatment Plan-Medications / Recheck / Client Communication

To-Do List
  (bulleted action items — Rx to dispense, appointments to schedule, reminders)`;

const TEMPLATE_LAB_RADIOLOGY = `DOCUMENT TYPE: RADIOLOGY REVIEW / REFERENCE LAB SAMPLE SUBMISSION

Distinct from a referral letter. Summarize patient history and pertinent exam findings only, to accompany a sample or imaging submission rather than to request a specialist consult. This document type is not as rigidly specified as the referral letter or SOAP exam record — use clinical judgment on structure, keeping it concise and focused on history plus pertinent findings.`;

const FORMATTING_RULES = `FORMATTING RULES
- Letterhead (referral letters only): bold practice name + address/phone line, thin horizontal rule beneath
- Body font: standard serif/sans, headings in accent blue
- Bullets for enumerated clinical findings; prose paragraphs for narrative history
- No length cap — length follows case complexity
- Tone: professional, collegial, third-person clinical — no first-person clinician commentary beyond framing sentences`;

const INPUT_NOTES = `NOTES ON INPUT DATA
- Patient name is often absent from "Comprehensive Summary" PDFs — confirm with the user before drafting if missing
- Species/breed/sex/age are usually in a Signalment block
- Attending vet name/credentials sometimes appear in lab report headers (e.g. IDEXX "ATTENDING VET" field)
- Lab/pathology report PDFs (e.g. IDEXX) are sometimes OCR-garbled in a secondary embedded text layer — prioritize the first-pass extracted/readable text
- Any complication, correction, or detail stated by the user in chat but not present in a source document should be incorporated into the letter as fact
- Never assume which hospital/specialist to refer to — confirm with the user per-referral, since mobile and fixed-address hospitals need different addressing conventions`;

const TEMPLATE_BY_USE = {
  referral_letter: TEMPLATE_REFERRAL_LETTER,
  soap_record: TEMPLATE_SOAP_RECORD,
  lab_history: TEMPLATE_LAB_RADIOLOGY,
  radiology_review: TEMPLATE_LAB_RADIOLOGY,
};

function buildClaudePrompt(capture) {
  const template = TEMPLATE_BY_USE[capture.intendedUse] || "";
  const lines = [
    "You are drafting a veterinary document for Austin Graham, DVM at Park Hill Veterinary Medical Center. Follow the instructions below exactly, using the capture data at the end of this message.",
    "",
    STANDING_PREFERENCES,
    "",
  ];
  if (template) {
    lines.push(template, "");
  }
  lines.push(FORMATTING_RULES, "", INPUT_NOTES, "", "---", "", "CAPTURE METADATA");
  lines.push(`Patient: ${fmtName(capture.patientFirst, capture.patientLast)}`);
  lines.push(`Doctor: Dr. ${fmtName(capture.doctorFirst, capture.doctorLast)}`);
  lines.push(`Date: ${capture.date || "(not specified)"}`);
  lines.push(`Intended use: ${USE_LABELS[capture.intendedUse] || capture.intendedUse || "(not specified)"}`);
  lines.push("", "CAPTURED CONTENT");

  const text = (capture.text || "").trim();
  const files = capture.files || [];
  if (text) lines.push(text);
  if (files.length === 1) {
    lines.push(text ? "" : "", `[Attached file: ${files[0].name || "unnamed file"} — attach it manually in this chat before sending]`);
  } else if (files.length > 1) {
    lines.push(
      text ? "" : "",
      `[Attached files (${files.length}) — attach these manually in this chat before sending]`,
      ...files.map((f) => `- ${f.name || "unnamed file"}`)
    );
  }
  if (!text && files.length === 0) lines.push("(no content captured)");

  return lines.join("\n");
}

async function copyPrompt(capture) {
  const prompt = buildClaudePrompt(capture);
  try {
    await navigator.clipboard.writeText(prompt);
    showToast(
      (capture.files || []).length > 0
        ? "Prompt copied — attach the file(s) manually wherever you paste it"
        : "Prompt copied to clipboard"
    );
  } catch (err) {
    console.error("Copy failed", err);
  }
}

function sendToClaudeDesktop(capture) {
  const prompt = buildClaudePrompt(capture);
  const url = `claude://claude.ai/new?q=${encodeURIComponent(prompt)}`;
  chrome.tabs.create({ url });
  showToast(
    (capture.files || []).length > 0
      ? "Opening Claude Desktop — attach the file(s) manually"
      : "Opening Claude Desktop…"
  );
}

async function sendToClaudeBrowser(capture) {
  const prompt = buildClaudePrompt(capture);
  try {
    await navigator.clipboard.writeText(prompt);
  } catch (err) {
    console.error("Copy failed", err);
  }
  chrome.tabs.create({ url: "https://claude.ai/new" });
  showToast(
    (capture.files || []).length > 0
      ? "Copied — paste in the new tab, then attach the file(s) manually"
      : "Copied — paste it into the new tab"
  );
}

els.contentImage.addEventListener("change", () => {
  const files = Array.from(els.contentImage.files || []);
  if (files.length === 0) return;

  let remaining = files.length;
  files.forEach((file) => {
    const reader = new FileReader();
    reader.onload = () => {
      pendingFiles.push({ dataUrl: reader.result, name: file.name, type: file.type });
      remaining -= 1;
      if (remaining === 0) {
        renderFileChips();
        els.contentImage.value = ""; // allow re-adding the same file later, and lets more be picked
      }
    };
    reader.readAsDataURL(file);
  });
});

els.setDefaultDoctorBtn.addEventListener("click", async () => {
  await setSettings({
    ...(await getSettings()),
    defaultDoctorFirst: els.doctorFirst.value.trim(),
    defaultDoctorLast: els.doctorLast.value.trim(),
  });
  await refreshDefaultDoctorLabel();
});

els.clearDefaultDoctorBtn.addEventListener("click", async () => {
  const settings = await getSettings();
  await setSettings({ ...settings, defaultDoctorFirst: "", defaultDoctorLast: "" });
  await refreshDefaultDoctorLabel();
});

async function refreshDefaultDoctorLabel() {
  const settings = await getSettings();
  const hasDefault = Boolean(settings.defaultDoctorFirst || settings.defaultDoctorLast);
  els.defaultDoctorLabel.textContent = hasDefault
    ? `Default: Dr. ${fmtName(settings.defaultDoctorFirst, settings.defaultDoctorLast)}`
    : "No default doctor set";
  els.clearDefaultDoctorBtn.classList.toggle("hidden", !hasDefault);
}

els.clearBtn.addEventListener("click", resetForm);

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const text = els.contentText.value.trim();
  const hasText = text.length > 0;
  const hasFiles = pendingFiles.length > 0;
  if (!hasText && !hasFiles) {
    els.contentText.focus();
    return;
  }
  if (!els.intendedUse.value) {
    els.intendedUse.focus();
    return;
  }

  const captures = await getCaptures();
  const base = {
    tagged: true,
    patientFirst: els.patientFirst.value.trim(),
    patientLast: els.patientLast.value.trim(),
    doctorFirst: els.doctorFirst.value.trim(),
    doctorLast: els.doctorLast.value.trim(),
    date: els.date.value || todayStr(),
    intendedUse: els.intendedUse.value,
    text,
    files: pendingFiles.map((f) => ({ dataUrl: f.dataUrl, name: f.name, type: f.type })),
  };

  if (editingId) {
    const idx = captures.findIndex((c) => c.id === editingId);
    if (idx !== -1) {
      captures[idx] = { ...captures[idx], ...base };
    }
  } else {
    captures.unshift({ id: crypto.randomUUID(), createdAt: Date.now(), ...base });
  }

  await setCaptures(captures);
  await updateDoctorHistory(base.doctorFirst, base.doctorLast);
  await renderDoctorHistorySelect();
  resetForm();
  render();
});

async function prefillFromPageSelection() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;
    chrome.tabs.sendMessage(tab.id, { type: "GET_SELECTION" }, (response) => {
      if (chrome.runtime.lastError) return;
      const selection = response && response.selection ? response.selection.trim() : "";
      if (selection && !editingId && !els.contentText.value) {
        els.contentText.value = selection;
      }
    });
  } catch (err) {
    // Non-fatal — page may not support content scripts.
  }
}

(async function init() {
  els.date.value = todayStr();
  await refreshDefaultDoctorLabel();
  await renderDoctorHistorySelect();
  const settings = await getSettings();
  if (settings.defaultDoctorFirst || settings.defaultDoctorLast) {
    els.doctorFirst.value = settings.defaultDoctorFirst || "";
    els.doctorLast.value = settings.defaultDoctorLast || "";
  }
  await render();
  await prefillFromPageSelection();
})();
