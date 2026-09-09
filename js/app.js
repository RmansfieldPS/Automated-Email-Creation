/* Email Builder — all client logic.
 * Classic script (no modules): handlers referenced by inline onclick must be global.
 * All Marketo access goes through the 'marketo' Edge Function — no secrets here.
 */

var CFG = window.EB_CONFIG || {};
var sb = null;          // supabase client
var ME = null;          // auth user
var TEMPLATES = [];
var CUR_TPL = null;     // template being built from
var CUR_TOKENS = [];    // tokens fetched for CUR_TPL

// ---------- helpers ----------
function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function showToast(msg) {
  var t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._h);
  t._h = setTimeout(function () { t.classList.add("hidden"); }, 3500);
}

// ---------- boot ----------
(function boot() {
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) {
    document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif">Missing Supabase config in js/config.js</div>';
    return;
  }
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  sb.auth.onAuthStateChange(function (_evt, session) {
    ME = session ? session.user : null;
    renderAuth();
  });
})();

function renderAuth() {
  if (ME) {
    $("login-overlay").classList.add("hidden");
    $("app").classList.remove("hidden");
    $("me-email").textContent = ME.email || "";
    loadTemplates();
    loadHistory();
  } else {
    $("app").classList.add("hidden");
    $("login-overlay").classList.remove("hidden");
  }
}

function doLogin(e) {
  e.preventDefault();
  $("login-err").textContent = "";
  sb.auth.signInWithPassword({
    email: $("login-email").value.trim(),
    password: $("login-pass").value,
  }).then(function (res) {
    if (res.error) $("login-err").textContent = res.error.message;
  });
}

function doLogout() { sb.auth.signOut(); }

// ---------- views ----------
function showView(v) {
  $("view-new").classList.toggle("hidden", v !== "new");
  $("view-history").classList.toggle("hidden", v !== "history");
  $("nav-new").classList.toggle("active", v === "new");
  $("nav-history").classList.toggle("active", v === "history");
  if (v === "history") loadHistory();
}

// ---------- templates ----------
function loadTemplates() {
  sb.from("eb_templates").select("*").eq("active", true)
    .order("sort").order("name")
    .then(function (res) {
      TEMPLATES = res.data || [];
      var el = $("tpl-cards");
      if (res.error) { el.innerHTML = '<div class="empty">Error loading templates: ' + esc(res.error.message) + "</div>"; return; }
      if (!TEMPLATES.length) {
        el.innerHTML = '<div class="empty">No templates registered yet. Add rows to <code>eb_templates</code> in Supabase.</div>';
        return;
      }
      el.innerHTML = TEMPLATES.map(function (t) {
        return '<button class="tpl-card" onclick="pickTemplate(\'' + t.id + '\')">' +
          "<h3>" + esc(t.name) + "</h3><p>" + esc(t.description || "") + "</p></button>";
      }).join("");
      // Single-template mode: the whole app is just the form — skip the picker.
      if (TEMPLATES.length === 1 && !CUR_TPL) pickTemplate(TEMPLATES[0].id);
    });
}

function pickTemplate(id) {
  CUR_TPL = TEMPLATES.find(function (t) { return t.id === id; });
  if (!CUR_TPL) return;
  $("tpl-picker").classList.add("hidden");
  $("builder").classList.remove("hidden");
  $("back-btn").classList.toggle("hidden", TEMPLATES.length === 1);
  $("builder-title").textContent = CUR_TPL.name;
  $("builder-desc").textContent = CUR_TPL.description || "";
  $("f-name").value = "";
  $("create-result").classList.add("hidden");
  $("token-fields").innerHTML = '<div class="empty">Fetching tokens from Marketo…</div>';
  callFn({ action: "tokens", programId: CUR_TPL.marketo_program_id })
    .then(function (r) {
      // Only token types the API can write back. Programs may also carry
      // 'script block' (Velocity personalization, e.g. first-name casing) —
      // those run at send time and must not appear in the form.
      var editable = ["text", "rich text", "date", "number", "score"];
      CUR_TOKENS = (r.tokens || []).filter(function (t) { return editable.indexOf(t.type) !== -1; });
      renderTokenFields();
    })
    .catch(function (e) {
      $("token-fields").innerHTML = '<div class="empty">Could not load tokens: ' + esc(e.message) + "</div>";
    });
}

function backToPicker() {
  $("builder").classList.add("hidden");
  $("tpl-picker").classList.remove("hidden");
  CUR_TPL = null; CUR_TOKENS = [];
}

// token type -> input control
function renderTokenFields() {
  var el = $("token-fields");
  if (!CUR_TOKENS.length) {
    el.innerHTML = '<div class="empty">This program has no My Tokens — nothing to customize. You can still clone it.</div>';
    return;
  }
  // New lines in the rich text editors become <p>, matching Marketo markup
  try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch (e) {}
  el.innerHTML = CUR_TOKENS.map(function (tk, i) {
    var input;
    var v = esc(tk.value);
    if (tk.type === "rich text") {
      input = rteMarkup(i);
    } else if (tk.type === "date") {
      input = '<input type="date" id="tk-' + i + '" value="' + v + '">';
    } else if (tk.type === "number" || tk.type === "score") {
      input = '<input type="number" id="tk-' + i + '" value="' + v + '">';
    } else if (/image\s*url/i.test(tk.name)) {
      // Image tokens: type a URL or upload a file straight into Design Studio
      var hasUrl = /^https?:\/\//i.test(tk.value || "");
      input = '<div class="imgtok">' +
        '<input type="text" id="tk-' + i + '" value="' + v + '" oninput="imgTokenPreview(' + i + ')">' +
        '<button type="button" class="btn imgtok-btn" id="tkbtn-' + i + '" onclick="document.getElementById(\'tkfile-' + i + '\').click()">Upload image</button>' +
        '<input type="file" id="tkfile-' + i + '" accept="image/*" class="hidden" onchange="uploadTokenImage(' + i + ')">' +
        "</div>" +
        '<div class="imgtok-preview" id="tkprev-' + i + '">' + (hasUrl ? '<img src="' + v + '" alt="">' : "") + "</div>" +
        '<div class="hint">Upload sends the image to Marketo Design Studio (Email Builder Uploads) and fills in its URL automatically.</div>';
    } else {
      input = '<input type="text" id="tk-' + i + '" value="' + v + '">';
    }
    return '<div class="field"><label for="tk-' + i + '">' + esc(tk.name) +
      ' <span class="muted small">(' + esc(tk.type) + ')</span></label>' + input + "</div>";
  }).join("");
  // Initialize the rich text editors: template value in, paste as plain text
  CUR_TOKENS.forEach(function (tk, i) {
    if (tk.type !== "rich text") return;
    var ed = $("tk-" + i);
    ed.innerHTML = cleanHtml(tk.value || "");
    ed.addEventListener("paste", function (e) {
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, text);
    });
  });
}

// ---------- rich text editor ----------
// Zero-dependency contenteditable editor for 'rich text' tokens. Produces
// email-safe HTML; the </> toggle exposes raw source for exact snippets
// (e.g. the styled Hero Link anchor). All handlers global (inline onclick).

function rteMarkup(i) {
  function b(cmd, label, title) {
    return '<button type="button" class="rte-btn" title="' + title +
      '" onmousedown="event.preventDefault()" onclick="rteCmd(' + i + ",'" + cmd + "')\">" + label + "</button>";
  }
  return '<div class="rte">' +
    '<div class="rte-toolbar">' +
      b("bold", "<b>B</b>", "Bold") +
      b("italic", "<i>I</i>", "Italic") +
      b("insertUnorderedList", "&bull; List", "Bullet list") +
      b("insertOrderedList", "1. List", "Numbered list") +
      '<button type="button" class="rte-btn" title="Turn selected text into a link" onmousedown="event.preventDefault()" onclick="rteLink(' + i + ')">Link</button>' +
      b("reg", "&reg;", "Insert superscript ®") +
      b("clear", "Clear", "Remove formatting from selection") +
      '<button type="button" class="rte-btn rte-src-btn" title="View / edit raw HTML" onclick="rteToggleSrc(' + i + ')">&lt;/&gt;</button>' +
    "</div>" +
    '<div class="rte-area" id="tk-' + i + '" contenteditable="true"></div>' +
    '<textarea class="rte-srcarea hidden" id="tksrc-' + i + '" spellcheck="false"></textarea>' +
    "</div>" +
    '<div class="hint">Pastes as plain text. Use &lt;/&gt; to paste an exact HTML snippet. Leave empty to keep the template default.</div>';
}

function rteCmd(i, cmd) {
  var ed = $("tk-" + i);
  if (!ed || ed.classList.contains("hidden")) return; // source mode: type HTML directly
  if (document.activeElement !== ed) ed.focus();
  if (cmd === "reg") document.execCommand("insertHTML", false, "<sup>&reg;</sup>");
  else if (cmd === "clear") { document.execCommand("removeFormat"); document.execCommand("unlink"); }
  else document.execCommand(cmd, false, null);
}

function rteLink(i) {
  var ed = $("tk-" + i);
  if (!ed || ed.classList.contains("hidden")) return;
  if (document.activeElement !== ed) ed.focus();
  var sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) { showToast("Select the text to turn into a link first"); return; }
  var url = prompt("Link URL (https://…)");
  if (url && url.trim()) document.execCommand("createLink", false, url.trim());
}

function rteToggleSrc(i) {
  var ed = $("tk-" + i), src = $("tksrc-" + i);
  if (src.classList.contains("hidden")) {
    src.value = cleanHtml(ed.innerHTML);
    ed.classList.add("hidden"); src.classList.remove("hidden");
    src.style.height = Math.max(130, ed.offsetHeight) + "px";
    src.focus();
  } else {
    ed.innerHTML = cleanHtml(src.value);
    src.classList.add("hidden"); ed.classList.remove("hidden");
  }
}

// Current value of a rich text field: raw from source mode (sent verbatim),
// sanitized from the visual editor. '' = keep template default.
function rteValue(i) {
  var src = $("tksrc-" + i);
  if (src && !src.classList.contains("hidden")) return src.value.trim();
  var ed = $("tk-" + i);
  return cleanHtml(ed ? ed.innerHTML : "");
}

// Keep only email-safe markup: allowed tags, style attr, href/target on links.
// Normalizes contenteditable's <div> line breaks to <p>, drops empty paragraphs.
function cleanHtml(html) {
  if (!html) return "";
  var ALLOWED = { P: 1, BR: 1, STRONG: 1, B: 1, EM: 1, I: 1, U: 1, A: 1, UL: 1, OL: 1, LI: 1, SUP: 1, SUB: 1, SPAN: 1 };
  var root = document.createElement("div");
  root.innerHTML = html;
  (function walk(node) {
    Array.prototype.slice.call(node.childNodes).forEach(function (child) {
      if (child.nodeType === 8) { node.removeChild(child); return; } // comments
      if (child.nodeType !== 1) return;
      var tag = child.tagName;
      if (tag === "SCRIPT" || tag === "STYLE") { node.removeChild(child); return; }
      walk(child);
      if (tag === "DIV") {
        var p = document.createElement("p");
        while (child.firstChild) p.appendChild(child.firstChild);
        node.replaceChild(p, child);
        child = p; tag = "P";
      }
      if (!ALLOWED[tag]) { // unwrap unknown tags, keep their content
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        node.removeChild(child);
        return;
      }
      Array.prototype.slice.call(child.attributes).forEach(function (a) {
        var keep = a.name === "style" ||
          (tag === "A" && (a.name === "href" || a.name === "target") && !/^\s*javascript:/i.test(a.value));
        if (!keep) child.removeAttribute(a.name);
      });
    });
  })(root);
  var out = root.innerHTML.replace(/<p>(\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, "").trim();
  return /^(\s|&nbsp;|<br\s*\/?>)*$/i.test(out) ? "" : out;
}

// ---------- image token upload ----------
function imgTokenPreview(i) {
  var v = $("tk-" + i).value.trim();
  $("tkprev-" + i).innerHTML = /^https?:\/\//i.test(v) ? '<img src="' + esc(v) + '" alt="">' : "";
}

function uploadTokenImage(i) {
  var fileEl = $("tkfile-" + i), btn = $("tkbtn-" + i);
  var f = fileEl.files && fileEl.files[0];
  if (!f) return;
  if (!/^image\//.test(f.type)) { showToast("Please choose an image file"); fileEl.value = ""; return; }
  if (f.size > 8 * 1024 * 1024) { showToast("Image too large (max 8 MB)"); fileEl.value = ""; return; }
  btn.disabled = true;
  btn.textContent = "Uploading…";
  var fd = new FormData();
  fd.append("action", "uploadImage");
  fd.append("file", f, f.name);
  callFn(fd)
    .then(function (r) {
      $("tk-" + i).value = r.url;
      imgTokenPreview(i);
      showToast("Image uploaded to Design Studio");
    })
    .catch(function (err) { showToast("Upload failed: " + err.message); })
    .then(function () { btn.disabled = false; btn.textContent = "Upload image"; fileEl.value = ""; });
}

// ---------- create ----------
function doCreate(e) {
  e.preventDefault();
  if (!CUR_TPL) return;
  var name = $("f-name").value.trim();
  if (!name) return;

  var tokens = CUR_TOKENS.map(function (tk, i) {
    if (tk.type === "rich text") return { name: tk.name, type: tk.type, value: rteValue(i) };
    var el = $("tk-" + i);
    return { name: tk.name, type: tk.type, value: el ? el.value : tk.value };
  });

  var btn = $("create-btn"), st = $("create-status");
  btn.disabled = true;
  st.textContent = "Cloning program in Marketo… (can take ~30s for big programs)";
  $("create-result").classList.add("hidden");

  callFn({ action: "create", templateId: CUR_TPL.id, programName: name, tokens: tokens })
    .then(function (r) {
      st.textContent = "";
      btn.disabled = false;
      var box = $("create-result");
      box.classList.remove("hidden", "err");
      box.innerHTML = "<strong>✅ Program created</strong> — Marketo id " + esc(r.programId) +
        ", " + (r.tokensWritten ? r.tokensWritten.length : 0) + " tokens written." +
        (r.url ? ' <a href="' + esc(r.url) + '" target="_blank" rel="noopener">Open in Marketo →</a>' : "") +
        '<div class="muted small" style="margin-top:6px">Review + approve the emails in Marketo before scheduling anything.</div>';
      loadHistory();
      showToast("Created “" + name + "”");
    })
    .catch(function (err) {
      st.textContent = "";
      btn.disabled = false;
      var box = $("create-result");
      box.classList.remove("hidden");
      box.classList.add("err");
      box.innerHTML = "<strong>❌ Failed:</strong> " + esc(err.message);
    });
}

// ---------- history ----------
function loadHistory() {
  sb.from("eb_runs")
    .select("*, eb_templates(name)")
    .order("created_at", { ascending: false })
    .limit(100)
    .then(function (res) {
      var el = $("history-table");
      if (res.error) { el.innerHTML = '<div class="empty">' + esc(res.error.message) + "</div>"; return; }
      var rows = res.data || [];
      if (!rows.length) { el.innerHTML = '<div class="empty">Nothing created yet.</div>'; return; }
      el.innerHTML = "<table><thead><tr><th>Program</th><th>Template</th><th>By</th><th>When</th><th>Status</th></tr></thead><tbody>" +
        rows.map(function (r) {
          var when = new Date(r.created_at).toLocaleString();
          return "<tr><td>" + esc(r.program_name) +
            (r.new_program_id ? ' <span class="muted small">#' + esc(r.new_program_id) + "</span>" : "") +
            "</td><td>" + esc(r.eb_templates ? r.eb_templates.name : "—") +
            "</td><td>" + esc(r.created_by_email || "—") +
            "</td><td>" + esc(when) +
            '</td><td><span class="pill ' + esc(r.status) + '">' + esc(r.status) + "</span>" +
            (r.error ? '<div class="muted small">' + esc(r.error) + "</div>" : "") +
            "</td></tr>";
        }).join("") + "</tbody></table>";
    });
}

// ---------- edge function call ----------
function callFn(body) {
  return sb.functions.invoke("marketo", { body: body }).then(function (res) {
    if (res.error) {
      // FunctionsHttpError: pull the JSON error message out of the response
      if (res.error.context && typeof res.error.context.json === "function") {
        return res.error.context.json().then(function (j) {
          throw new Error(j.error || res.error.message);
        }).catch(function (e2) {
          throw (e2 instanceof Error && e2.message !== "Failed to fetch") ? e2 : new Error(res.error.message);
        });
      }
      throw new Error(res.error.message);
    }
    if (res.data && res.data.error) throw new Error(res.data.error);
    return res.data;
  });
}
