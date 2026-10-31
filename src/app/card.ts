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
if (!root) throw new Error('找不到卡片根元素');

const app = new App({ name: 'inloop-review-list', version });

function applyContext(context: McpUiHostContext | undefined): void {
  if (!context) return;
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
}

app.onhostcontextchanged = applyContext;
app.ontoolresult = (params) => {
  const records = (params.structuredContent as { records?: CardRecord[] } | undefined)?.records ?? [];
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
          text: `呼叫失敗：${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  });
};

app.connect()
  .then(() => applyContext(app.getHostContext()))
  .catch((error: unknown) => {
    root.textContent = `App 連線失敗：${error instanceof Error ? error.message : String(error)}`;
  });
