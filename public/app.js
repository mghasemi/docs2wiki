const $ = (id) => document.getElementById(id);
const KIND_LABELS = {
  "github-wiki": "GitHub Wiki URL",
  readthedocs: "ReadTheDocs URL",
  local: "Local / MkDocs (mounted folder)",
  "upload-zip": "Upload zip (docs or MkDocs project)",
  "upload-dir": "Upload folder",
};
let config = { folders: [], workspaceAvailable: false };
let activeStream = null;
let activeJobId = null;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

async function api(path, options) {
  const res = await fetch(path, options);
  const body = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body;
}

function addSourceRow(kind = "github-wiki", value = "") {
  const row = el("div", { class: "source" });
  const select = el("select", {}, ...Object.entries(KIND_LABELS).map(([k, label]) => el("option", { value: k }, label)));
  select.value = kind;
  const valueBox = el("div");
  const render = () => {
    valueBox.replaceChildren();
    const k = select.value;
    if (k === "local") {
      const choices = config.folders;
      if (!config.workspaceAvailable || choices.length === 0) {
        valueBox.append(el("span", { class: "muted" }, "No mounted folder found. Put docs in ./docs-input."));
      }
      const sel = el("select", { "data-role": "value" }, ...choices.map((f) => el("option", { value: f }, f)));
      if (value) sel.value = value;
      valueBox.append(sel);
    } else if (k === "upload-zip") {
      valueBox.append(el("input", { type: "file", accept: ".zip", "data-role": "file" }));
    } else if (k === "upload-dir") {
      const input = el("input", { type: "file", multiple: "", webkitdirectory: "", "data-role": "file" });
      valueBox.append(input);
    } else {
      valueBox.append(
        el("input", { type: "url", "data-role": "value", placeholder: k === "github-wiki" ? "https://github.com/OWNER/REPO" : "https://project.readthedocs.io/en/latest/", value }),
      );
    }
  };
  select.addEventListener("change", () => { value = ""; render(); });
  render();
  row.append(select, valueBox, el("button", { type: "button", class: "secondary small", onclick: () => row.remove() }, "Remove"));
  row.getValue = () => ({ kind: select.value, valueEl: valueBox.querySelector("[data-role=value]"), fileEl: valueBox.querySelector("[data-role=file]") });
  $("sources").append(row);
}

async function submitForm(event) {
  event.preventDefault();
  $("form-error").textContent = "";
  const sources = [];
  const form = new FormData();
  let uploadIndex = 0;
  for (const row of $("sources").children) {
    const { kind, valueEl, fileEl } = row.getValue();
    if (kind.startsWith("upload")) {
      const files = [...(fileEl.files ?? [])];
      if (files.length === 0) return ($("form-error").textContent = "Choose a file or folder for each upload source.");
      const key = String(uploadIndex++);
      files.forEach((f) => form.append(`upload:${key}`, f, f.webkitRelativePath || f.name));
      sources.push({ kind: "upload", value: key });
    } else {
      const value = valueEl?.value?.trim();
      if (!value) return ($("form-error").textContent = "Every source needs a value.");
      sources.push({ kind, value });
    }
  }
  if (sources.length === 0) return ($("form-error").textContent = "Add at least one source.");

  const payload = {
    title: $("title").value,
    sources,
    maxPages: Number($("maxPages").value),
    maxDepth: Number($("maxDepth").value),
    cacheTtlMinutes: Number($("ttl").value),
    useCache: $("useCache").checked,
    strictStaleFallback: $("strict").checked,
    skipPdf: $("skipPdf").checked,
  };
  form.set("payload", JSON.stringify(payload));

  $("submit").disabled = true;
  try {
    // Multipart is always used so uploads and plain jobs share one path; payload must precede files server-side.
    const ordered = new FormData();
    ordered.append("payload", JSON.stringify(payload));
    for (const [k, v] of form.entries()) if (k !== "payload") ordered.append(k, v, v.name);
    const job = await api("/api/jobs", { method: "POST", body: ordered });
    watchJob(job.id);
    refreshHistory();
  } catch (e) {
    $("form-error").textContent = e.message;
  } finally {
    $("submit").disabled = false;
  }
}

function downloadLinks(job) {
  const names = { md: "Markdown", pdf: "PDF", report: "Report" };
  return Object.entries(names)
    .filter(([k]) => job.files?.[k])
    .map(([k, label]) => el("a", { class: "dl", href: `/api/jobs/${job.id}/files/${k}` }, label));
}

function setStatus(job) {
  $("live-status").textContent = job.status;
  $("live-status").className = `badge ${job.status}`;
  const active = job.status === "queued" || job.status === "running";
  $("cancel").hidden = !active;
  if (!active) {
    api(`/api/jobs/${job.id}`).then((full) => {
      const box = $("result");
      box.replaceChildren(...downloadLinks(full));
      if (full.error) box.append(el("div", { class: "error" }, full.error));
      for (const w of full.warnings ?? []) box.append(el("div", { class: "warn" }, `⚠ ${typeof w === "string" ? w : JSON.stringify(w)}`));
    });
    refreshHistory();
  }
}

function watchJob(id) {
  activeStream?.close();
  activeJobId = id;
  $("live").hidden = false;
  $("log").textContent = "";
  $("result").replaceChildren();
  const stream = new EventSource(`/api/jobs/${id}/events`);
  activeStream = stream;
  stream.addEventListener("log", (e) => {
    const log = $("log");
    log.append(JSON.parse(e.data) + "\n");
    log.scrollTop = log.scrollHeight;
  });
  stream.addEventListener("status", (e) => {
    const job = JSON.parse(e.data);
    setStatus(job);
    if (!["queued", "running"].includes(job.status)) stream.close();
  });
  stream.onerror = () => stream.close();
  $("live").scrollIntoView({ behavior: "smooth" });
}

async function refreshHistory() {
  const jobs = await api("/api/jobs");
  $("history").replaceChildren(
    ...jobs.map((job) =>
      el("tr", {},
        el("td", {}, job.title),
        el("td", {}, el("span", { class: `badge ${job.status}` }, job.status)),
        el("td", {}, new Date(job.createdAt).toLocaleString()),
        el("td", {}, ...downloadLinks(job)),
        el("td", { class: "actions" },
          el("button", { class: "secondary small", onclick: () => watchJob(job.id) }, "Log"), " ",
          el("button", { class: "secondary small", onclick: () => rerun(job) }, "Re-run"), " ",
          el("button", { class: "secondary small", onclick: async () => { await api(`/api/jobs/${job.id}`, { method: "DELETE" }); refreshHistory(); } }, "Delete"),
        ),
      ),
    ),
  );
}

function rerun(job) {
  $("title").value = job.request.title;
  $("maxPages").value = job.request.maxPages;
  $("maxDepth").value = job.request.maxDepth;
  $("ttl").value = job.request.cacheTtlMinutes;
  $("useCache").checked = job.request.useCache;
  $("strict").checked = job.request.strictStaleFallback;
  $("skipPdf").checked = job.request.skipPdf;
  $("sources").replaceChildren();
  // Uploaded sources cannot be replayed from the browser, so only URL and mounted-folder sources are restored.
  for (const s of job.request.sources) if (s.kind !== "upload") addSourceRow(s.kind, s.value);
  if ($("sources").children.length === 0) addSourceRow();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function init() {
  config = await api("/api/config");
  addSourceRow();
  $("add-source").addEventListener("click", () => addSourceRow());
  $("job-form").addEventListener("submit", submitForm);
  $("cancel").addEventListener("click", () => activeJobId && api(`/api/jobs/${activeJobId}/cancel`, { method: "POST" }));
  $("clear-cache").addEventListener("click", async () => {
    try { await api("/api/cache/clear", { method: "POST" }); $("form-error").textContent = "Cache cleared."; }
    catch (e) { $("form-error").textContent = e.message; }
  });
  refreshHistory();
  setInterval(refreshHistory, 10000);
}

init();
