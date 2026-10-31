// Smoke test for the spike server. Uses a temp copy of state so it doesn't touch real review results.
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolated state file so the smoke test never touches the user's real review results.
const STATE = path.join(os.tmpdir(), `inloop-spike-smoke-${process.pid}.json`);
process.env.INLOOP_SPIKE_STATE = STATE;

async function connect(label, capabilities, onElicit) {
  const client = new Client({ name: `smoke-${label}`, version: "0" }, { capabilities });
  if (onElicit) client.setRequestHandler("elicitation/create", onElicit);
  await client.connect(new StdioClientTransport({ command: "node", args: ["server.mjs"], env: { ...process.env } }));
  await new Promise((r) => setTimeout(r, 300));
  return client;
}

try {
  const plain = await connect("no-ui", {});
  console.log("no-ui tools:", (await plain.listTools()).tools.map((t) => t.name));
  await plain.close();

  let elicitParams;
  const ui = await connect(
    "ui",
    { elicitation: { form: {} }, extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } },
    async (req) => {
      elicitParams = req.params;
      return { action: "accept", content: { confirmed: ["15"], note: "smoke" } };
    },
  );
  console.log("ui tools:", (await ui.listTools()).tools.map((t) => `${t.name}${t._meta?.ui?.visibility ? JSON.stringify(t._meta.ui.visibility) : ""}`));

  const show = await ui.callTool({ name: "show_review", arguments: {} });
  console.log("show_review markdown starts:", JSON.stringify(show.content[0].text.slice(0, 120)));
  console.log("show_review records:", show.structuredContent.records.map((r) => r.id));

  const p = await ui.getPrompt({ name: "confirmed", arguments: { ids: "14 99" } });
  console.log("/confirmed 14 99 ->", p.messages[0].content.text);

  const c = await ui.callTool({ name: "confirm_list", arguments: {} });
  console.log("confirm_list form options:", elicitParams.requestedSchema.properties.confirmed.items.anyOf.map((o) => o.const));
  console.log("confirm_list ->", c.content[0].text);

  const s = await ui.callTool({ name: "submit_review", arguments: { ids: [16], verdict: "unimportant" } });
  console.log("submit_review ->", s.content[0].text);

  console.log("state:", JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(STATE, "utf-8"))).map(([k, v]) => [k, `${v.verdict}/${v.source}`]))));
  await ui.close();
} finally {
  if (fs.existsSync(STATE)) fs.rmSync(STATE);
}
