// Throwaway spike: compares three ways to confirm InLoop records in VS Code Copilot Chat.
//   C  = Markdown in chat (native "Ask in Side Panel") + slim list card with buttons (app-only tool)
//   E  = elicitation form above the chat input (user-only answers)
//   P  = /inloop-spike.confirmed prompt (runs on the server when the user types it)
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import {
  registerAppTool,
  registerAppResource,
  getUiCapability,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOG = path.join(HERE, "spike-log.jsonl");
const STATE = process.env.INLOOP_SPIKE_STATE || path.join(HERE, "spike-reviews.json");
const RESOURCE_URI = "ui://inloop-spike/review-list.html";

function log(event, data = {}) {
  fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), event, ...data }) + "\n");
}

const RECORDS = [
  {
    id: 14,
    title: "重試機制改成 exponential backoff",
    keyPoint: "失敗後等待時間加倍（1→2→4→8 秒），讓下游有時間恢復，而不是一起重打。",
    whatHow: "固定 1 秒重試 → 1→2→4→8 秒，最多 5 次（`retry.ts`）。",
    why: "下游掛掉時，固定間隔會讓大量請求同時重打。",
    shouldKnow: ["**概念**｜jitter：加入隨機延遲，避免所有 client 同步重試", "**風險**｜上限寫死 5 次，之後可能要做成設定"],
    coreDiff: "- await sleep(1000)\n+ await sleep(2 ** attempt * 1000)\n+ if (attempt >= 5) throw err",
    file: "src/retry.ts",
  },
  {
    id: 15,
    title: "timeout 從 10 秒改成 30 秒",
    keyPoint: "下游 API 的 p99 約 20 秒，10 秒 timeout 會把正常請求誤判為失敗。",
    whatHow: "`HTTP_TIMEOUT_MS` 由 10000 改為 30000（`client.ts`）。",
    why: "觀察到下游 p99 延遲約 20 秒，10 秒會造成大量假失敗與重試。",
    shouldKnow: ["**風險**｜timeout 變長，使用者等待失敗訊息的時間也變長"],
    coreDiff: "- const HTTP_TIMEOUT_MS = 10_000\n+ const HTTP_TIMEOUT_MS = 30_000",
    file: "src/client.ts",
  },
  {
    id: 16,
    title: "XSS 測試 <b>粗體?</b><img src=x onerror=\"document.body.style.background='red'\">",
    keyPoint: "這筆用來確認卡片把紀錄文字當純文字顯示。",
    whatHow: "標題含 HTML。",
    why: "卡片中若標題變粗體或背景變紅，代表 escape 失敗。",
    shouldKnow: ["**風險**｜紀錄是 agent 寫的，不可信任"],
    coreDiff: "<script>alert('should not run')</script>",
    file: "src/xss.ts",
  },
];

function loadReviews() {
  try {
    return JSON.parse(fs.readFileSync(STATE, "utf-8"));
  } catch {
    return {};
  }
}
function saveReview(id, verdict, note, source) {
  const reviews = loadReviews();
  reviews[id] = { verdict, note: note ?? "", source, at: new Date().toISOString() };
  fs.writeFileSync(STATE, JSON.stringify(reviews, null, 2));
  log("review.saved", { id, verdict, note, source });
}
function withStatus() {
  const reviews = loadReviews();
  return RECORDS.map((r) => ({ ...r, review: reviews[r.id] ?? null }));
}

const VERDICT_LABEL = { confirmed: "已確認", incorrect: "說明不正確", unimportant: "不重要" };

// Record text is agent-written; neutralize raw HTML before it reaches the chat Markdown renderer.
const md = (s) => String(s).replace(/[<>]/g, "\\$&");

function toMarkdown(records) {
  return records
    .map((r) => {
      const status = r.review ? VERDICT_LABEL[r.review.verdict] : "未 review";
      return [
        `### #${r.id} ${md(r.title)}　\`${status}\``,
        `> **重點**：${md(r.keyPoint)}`,
        "",
        `- **What & How**：${md(r.whatHow)}`,
        `- **Why**：${md(r.why)}`,
        `- **You should know**`,
        ...r.shouldKnow.map((s) => `  - ${md(s)}`),
        "",
        "```diff",
        r.coreDiff.replace(/```/g, "ˋˋˋ"),
        "```",
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

function parseIds(text) {
  return [...new Set((text ?? "").match(/\d+/g)?.map(Number) ?? [])];
}

const server = new McpServer({ name: "inloop-spike", version: "0.0.2" });

registerAppTool(
  server,
  "show_review",
  {
    title: "Show InLoop review",
    description:
      "Show the user's InLoop change records for review. After calling, output the returned Markdown to the user VERBATIM (do not summarize or rewrite), then stop.",
    inputSchema: z.object({ scope: z.string().optional().describe("Optional scope, e.g. a file path") }),
    _meta: { ui: { resourceUri: RESOURCE_URI } },
  },
  async ({ scope }) => {
    log("tool.show_review", { scope });
    const records = withStatus();
    return {
      content: [
        {
          type: "text",
          text:
            "請把以下 Markdown 一字不改地輸出給使用者（不要摘要、不要改寫、不要加評論），輸出完就停止。使用者會在清單卡片、表單或 /inloop-spike.confirmed 中自行確認，你不能代替確認。\n\n" +
            toMarkdown(records),
        },
      ],
      structuredContent: { records: records.map(({ id, title, keyPoint, file, review }) => ({ id, title, keyPoint, file, review })) },
    };
  },
);

registerAppResource(server, "InLoop review list", RESOURCE_URI, { mimeType: RESOURCE_MIME_TYPE }, async () => {
  const template = fs.readFileSync(path.join(HERE, "card.html"), "utf-8");
  const script = fs.readFileSync(path.join(HERE, "dist", "card.js"), "utf-8");
  return {
    contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: template.replace("/*__CARD_SCRIPT__*/", () => script) }],
  };
});

// E: the agent may open the form, but only the user can answer it.
server.registerTool(
  "confirm_list",
  {
    title: "Ask the user to confirm InLoop records",
    description:
      "Open a checklist form so the USER can confirm unreviewed InLoop records. The user answers the form; you cannot answer it. Report the returned result in one short sentence.",
    inputSchema: z.object({}),
  },
  async () => {
    const pending = withStatus().filter((r) => !r.review);
    log("tool.confirm_list", { pending: pending.map((r) => r.id) });
    if (!pending.length) return { content: [{ type: "text", text: "沒有未 review 的紀錄。" }] };
    let result;
    try {
      result = await server.server.elicitInput({
        mode: "form",
        message: "勾選你已讀懂、要確認的紀錄（可多選）。有不同理解再填備註。",
        requestedSchema: {
          type: "object",
          properties: {
            confirmed: {
              type: "array",
              title: "要確認的紀錄",
              items: { anyOf: pending.map((r) => ({ const: String(r.id), title: `#${r.id} ${r.title} — ${r.keyPoint}` })) },
            },
            note: { type: "string", title: "備註（可留空）" },
          },
        },
      });
    } catch (err) {
      log("elicitation.error", { message: String(err?.message ?? err) });
      return { isError: true, content: [{ type: "text", text: `無法開啟表單：${err?.message ?? err}` }] };
    }
    log("elicitation.result", result);
    if (result.action !== "accept") return { content: [{ type: "text", text: `使用者${result.action === "decline" ? "拒絕" : "取消"}了表單。` }] };
    const ids = (result.content?.confirmed ?? []).map(Number);
    for (const id of ids) saveReview(id, "confirmed", result.content?.note, "elicitation");
    return { content: [{ type: "text", text: ids.length ? `使用者確認了 ${ids.map((i) => "#" + i).join("、")}。` : "使用者沒有勾選任何紀錄。" }] };
  },
);

server.registerPrompt(
  "review",
  {
    title: "InLoop review",
    description: "Review InLoop change records",
    argsSchema: z.object({ scope: z.string().optional().describe("全部、檔案路徑、commit 或 today") }),
  },
  ({ scope }) => {
    log("prompt.review", { scope });
    return {
      messages: [
        { role: "user", content: { type: "text", text: `請呼叫 inloop-spike 的 show_review tool（scope：${scope || "全部"}），並把結果的 Markdown 原樣輸出。` } },
      ],
    };
  },
);

// P: prompts/get is issued by the host only when the user types the command, so the agent cannot trigger it.
server.registerPrompt(
  "confirmed",
  {
    title: "InLoop confirm",
    description: "確認紀錄，例如：14 15，或 all",
    argsSchema: z.object({
      ids: z.string().describe("要確認的紀錄編號，空白分隔；或 all"),
      note: z.string().optional().describe("備註（可留空）"),
    }),
  },
  ({ ids, note }) => {
    const pending = withStatus().filter((r) => !r.review).map((r) => r.id);
    const targets = /all/i.test(ids ?? "") ? pending : parseIds(ids).filter((id) => RECORDS.some((r) => r.id === id));
    log("prompt.confirmed", { ids, note, targets });
    for (const id of targets) saveReview(id, "confirmed", note, "prompt");
    const text = targets.length
      ? `（InLoop）使用者已透過 /confirmed 確認 ${targets.map((i) => "#" + i).join("、")}。請只回覆一句「已確認」加上編號，不要呼叫任何工具。`
      : `（InLoop）/confirmed 沒有對應到任何紀錄（輸入：${ids || "空"}）。請告訴使用者可用的編號：${pending.join("、") || "無"}。不要呼叫任何工具。`;
    return { messages: [{ role: "user", content: { type: "text", text } }] };
  },
);

let submitRegistered = false;
server.server.oninitialized = () => {
  const caps = server.server.getClientCapabilities();
  const supportsApps = Boolean(getUiCapability(caps)?.mimeTypes?.includes(RESOURCE_MIME_TYPE));
  log("initialized", { client: server.server.getClientVersion(), supportsApps, capabilities: caps });

  // Only expose the app-only confirm tool to hosts that hide it from the model.
  if (!supportsApps || submitRegistered) return;
  submitRegistered = true;
  registerAppTool(
    server,
    "submit_review",
    {
      title: "Submit InLoop review",
      description: "Save the user's review result. Only callable from the review list UI.",
      inputSchema: z.object({
        ids: z.array(z.number()),
        verdict: z.enum(["confirmed", "incorrect", "unimportant"]),
        note: z.string().optional(),
      }),
      _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
    },
    async ({ ids, verdict, note }) => {
      for (const id of ids) saveReview(id, verdict, note, "card");
      return { content: [{ type: "text", text: `${ids.map((i) => "#" + i).join("、")}：${VERDICT_LABEL[verdict]}` }] };
    },
  );
};

await server.connect(new StdioServerTransport());
log("started", { pid: process.pid, node: process.version });
