/* Admin postcode -> address picker.
   Attaches to any .addr-find button that carries data-target="<inputId>" where
   <inputId> is the id of the main address <input> to be filled.
   Expects sibling .addr-pc, .addr-select and .addr-note elements with the same
   data-target. Delegates events on document, so it works inside hidden/edit
   forms and dynamically-rendered modals. Backend proxy: /api/address-lookup. */
(function () {
  var CSS =
    ".addr-row{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;align-items:center}"
    + ".addr-pc{flex:1 1 140px;min-width:140px;padding:9px 12px;border:1px solid #c7cdd8;border-radius:6px;font:600 14px/1.2 system-ui,sans-serif;text-transform:uppercase;letter-spacing:0.5px}"
    + ".addr-pc:focus{outline:2px solid #e04e1b;outline-offset:1px;border-color:#e04e1b}"
    + ".addr-find{padding:9px 14px;border:none;border-radius:6px;background:#0d1f3c;color:#fff;font:700 13px/1 system-ui,sans-serif;cursor:pointer;letter-spacing:0.3px}"
    + ".addr-find:hover{background:#071530}"
    + ".addr-find:disabled{opacity:0.55;cursor:default}"
    + ".addr-select{width:100%;margin-top:6px;padding:10px 12px;border:1px solid #c7cdd8;border-radius:6px;font:500 14px/1.3 system-ui,sans-serif;background:#fff}"
    + ".addr-note{margin:4px 2px 0;font-size:12px;color:#b91c1c}"
    + ".addr-note.ok{color:#047857}";
  var s = document.createElement("style");
  s.id = "addr-picker-css";
  s.textContent = CSS;
  if (!document.getElementById("addr-picker-css")) document.head.appendChild(s);

  function note(target, msg, ok) {
    var n = document.querySelector('.addr-note[data-target="' + target + '"]');
    if (!n) return;
    n.textContent = msg || "";
    n.hidden = !msg;
    n.classList.toggle("ok", !!ok);
  }

  function esc(x) {
    return String(x).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c];
    });
  }

  document.addEventListener("click", async function (e) {
    var btn = e.target.closest(".addr-find");
    if (!btn) return;
    e.preventDefault();
    var target = btn.dataset.target;
    if (!target) return;
    var input = document.getElementById(target);
    var pcEl = document.querySelector('.addr-pc[data-target="' + target + '"]');
    var sel = document.querySelector('.addr-select[data-target="' + target + '"]');
    note(target, "");
    if (sel) sel.hidden = true;

    var pc = ((pcEl && pcEl.value) || (input && input.value) || "").trim();
    if (!pc) {
      note(target, "Enter a postcode first.");
      (pcEl || input) && (pcEl || input).focus();
      return;
    }
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Finding...";
    try {
      var r = await fetch("/api/address-lookup?postcode=" + encodeURIComponent(pc));
      if (r.status === 501) {
        note(target, "Address lookup not configured. Add IDEAL_POSTCODES_KEY in Vercel.");
        return;
      }
      var j = {};
      try { j = await r.json(); } catch (_) {}
      if (r.status === 400) {
        note(target, j.error || "Enter a valid UK postcode.");
        return;
      }
      if (!r.ok) {
        note(target, (j && j.error ? j.error + ". " : "Lookup unavailable. ") + "Please type the address.");
        return;
      }
      var list = (j && j.addresses) || [];
      if (!list.length) {
        note(target, "No addresses found for " + (j.postcode || pc) + ".");
        return;
      }
      if (sel) {
        sel.innerHTML = '<option value="">' + list.length + " addresses found, select one</option>"
          + list.map(function (a) { return "<option>" + esc(a) + "</option>"; }).join("");
        sel.hidden = false;
        sel.focus();
        note(target, "Pick your address from the list.", true);
      }
    } catch (_) {
      note(target, "Lookup unavailable. Please type the address.");
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });

  document.addEventListener("change", function (e) {
    var sel = e.target.closest(".addr-select");
    if (!sel) return;
    if (!sel.value) return;
    var input = document.getElementById(sel.dataset.target);
    if (input) {
      input.value = sel.value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    sel.hidden = true;
    note(sel.dataset.target, "");
  });
})();
