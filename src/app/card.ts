import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps';

import { renderList } from './render.js';
import type { CardRecord } from '../shared/card.js';

const version = '0.1.0';
const root = document.getElementById('root');
if (!root) throw new Error('Card root element not found');

const app = new App({ name: 'inloop-review-list', version });
let scope: string | undefined;

function applyContext(context: McpUiHostContext | undefined): void {
  if (!context) return;
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
}

async function loadRecords(): Promise<CardRecord[]> {
  const result = await app.callServerTool({
    name: 'review_records',
    arguments: scope ? { scope } : {},
  });
  if (result.isError) throw new Error(result.content.map((item) => (item.type === 'text' ? item.text : '')).join('\n'));
  return (result.structuredContent as { records?: CardRecord[] } | undefined)?.records ?? [];
}

app.onhostcontextchanged = applyContext;
app.ontoolinput = (params) => {
  const value = (params.arguments as { scope?: unknown } | undefined)?.scope;
  scope = typeof value === 'string' && value.length > 0 ? value : undefined;
};
app.ontoolresult = async (params) => {
  let records: CardRecord[];
  try {
    records = await loadRecords();
  } catch (error) {
    // Older servers (before review_records) still put the rows in structuredContent.
    const legacy = (params.structuredContent as { records?: CardRecord[] } | undefined)?.records;
    if (legacy === undefined) {
      root.textContent = `Could not load records: ${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    records = legacy;
  }
  renderList(root, records, {
    submit: async (ids, verdict, note) => {
      try {
        const result = await app.callServerTool({
          name: 'submit_review',
          arguments: { ids, verdict, ...(note ? { note } : {}) },
        });
        const text = result.content
          .filter((item) => item.type === 'text')
          .map((item) => item.text)
          .join('\n');
        return { ok: !result.isError, text };
      } catch (error) {
        return {
          ok: false,
          text: `Call failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  });
};

app.connect()
  .then(() => applyContext(app.getHostContext()))
  .catch((error: unknown) => {
    root.textContent = `App connection failed: ${error instanceof Error ? error.message : String(error)}`;
  });
