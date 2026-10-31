import { App, applyDocumentTheme, applyHostStyleVariables, applyHostFonts } from "@modelcontextprotocol/ext-apps";

const root = document.getElementById("root");
const app = new App({ name: "inloop-spike-list", version: "0.0.2" });
const LABEL = { confirmed: "已確認", incorrect: "說明不正確", unimportant: "不重要" };

let records = [];
let message = "";

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) node[k] = v;
    else if (v !== false && v != null) node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) if (c != null) node.append(typeof c === "string" ? document.createTextNode(c) : c);
  return node;
}

async function submit(ids, verdict, note) {
  message = "送出中…";
  render();
  try {
    const res = await app.callServerTool({ name: "submit_review", arguments: { ids, verdict, note } });
    const text = (res.content ?? []).map((c) => c.text ?? "").join("\n");
    if (!res.isError) {
      for (const r of records) if (ids.includes(r.id)) r.review = { verdict, note };
    }
    message = `${res.isError ? "❌ 失敗" : "✅"} ${text}`;
  } catch (err) {
    message = `❌ 呼叫失敗：${err?.message ?? err}`;
  }
  render();
}

function row(r) {
  const noteInput = el("input", { type: "text", placeholder: "我的理解不同／有疑問（可留空）", hidden: true });
  const done = Boolean(r.review);
  return el(
    "div",
    { class: `row${done ? " done" : ""}` },
    el("span", { class: "id" }, `#${r.id}`),
    el(
      "div",
      {},
      el("div", { class: "title" }, r.title),
      el("div", { class: "key" }, r.keyPoint),
      noteInput,
    ),
    el(
      "div",
      { class: "actions" },
      done
        ? el("span", { class: "badge ok" }, LABEL[r.review.verdict])
        : [
            el("button", { class: "primary", onclick: () => submit([r.id], "confirmed", noteInput.value.trim()) }, "Confirmed"),
            el("button", { title: "寫備註", onclick: () => { noteInput.hidden = !noteInput.hidden; if (!noteInput.hidden) noteInput.focus(); } }, "✎"),
            el("button", { onclick: () => submit([r.id], "incorrect", noteInput.value.trim()) }, "說明不正確"),
            el("button", { onclick: () => submit([r.id], "unimportant", noteInput.value.trim()) }, "不重要"),
          ].reduce((frag, b) => (frag.append(b), frag), document.createDocumentFragment()),
    ),
  );
}

function render() {
  const pending = records.filter((r) => !r.review);
  root.replaceChildren(
    el(
      "div",
      { class: "list" },
      el(
        "div",
        { class: "bar" },
        el("span", {}, `InLoop review · ${pending.length} 筆未 review／共 ${records.length} 筆`),
        el("span", { class: "spacer" }),
        el("button", { disabled: !pending.length, onclick: () => submit(pending.map((r) => r.id), "confirmed") }, "全部確認"),
      ),
      ...records.map(row),
      message ? el("div", { id: "msg" }, message) : null,
    ),
  );
}

function applyContext(ctx) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

app.onhostcontextchanged = applyContext;
app.ontoolresult = (params) => {
  records = params.structuredContent?.records ?? [];
  render();
};

app
  .connect()
  .then(() => applyContext(app.getHostContext()))
  .catch((err) => {
    root.textContent = `App 連線失敗：${err?.message ?? err}`;
  });
