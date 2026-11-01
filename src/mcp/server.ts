import { McpServer } from '@modelcontextprotocol/server';
import {
  getUiCapability,
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';

import { NotARepoError, openGit } from '../git/git.js';
import { openRepo, resolveRepoPath, type RepoContext } from '../repo.js';
import { ValidationError, amendChange, recordChange } from '../service/changes.js';
import { REVIEW_LABEL_EN } from '../service/labels.js';
import { renderReviewMarkdown } from '../service/markdown.js';
import { parseScope, selectScope, submitReview } from '../service/review.js';
import { formatWhy, whyQuery } from '../service/why.js';
import { storePathFor } from '../store/store.js';
import type { Store } from '../store/types.js';
import { findUnrecorded, sync } from '../sync/sync.js';
import {
  formatChangeList,
  formatUnrecorded,
  massChangeWarning,
  toCardRecords,
} from './format.js';

export const REVIEW_RESOURCE_URI = 'ui://inloop/review-list.html';

export interface CreateServerOptions {
  repoPath: string;
  appHtml: () => string;
  cwd?: string;
}

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

type RepoHandler = (context: RepoContext) => ToolResult | Promise<ToolResult>;

const shouldKnowSchema = z.object({
  kind: z.enum(['concept', 'risk', 'shortcut']).describe('類型：concept、risk 或 shortcut'),
  text: z.string().describe('內容，1–120 字元'),
});

const contentShape = {
  title: z.string().describe('標題，1–60 字元'),
  keyPoint: z.string().describe('重點，1–80 字元且最多 1 句'),
  whatHow: z.string().describe('What & How，1–300 字元且最多 3 句'),
  why: z.string().describe('Why，1–300 字元且最多 3 句；一個 Why 一筆'),
  shouldKnow: z.array(shouldKnowSchema).describe('You should know，1–5 條'),
  coreDiff: z.string().optional().describe('Core diff，最多 60 行'),
};

function result(text: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

function errorMessage(error: unknown, suffix?: string): ToolResult {
  if (error instanceof ValidationError) {
    return result([...error.messages, ...(suffix === undefined ? [] : [suffix])].join('\n'), true);
  }
  return result(error instanceof Error ? error.message : String(error), true);
}

export function createServer(opts: CreateServerOptions): McpServer {
  const server = new McpServer({ name: 'inloop', version: '0.1.0' });
  let cachedStore: Store | null = null;
  let cachedStorePath: string | null = null;

  function selectedPath(): string {
    return resolveRepoPath(
      ['--repo', opts.repoPath],
      process.env,
      opts.cwd ?? process.cwd(),
    );
  }

  function resetStore(): void {
    try {
      cachedStore?.close();
    } finally {
      cachedStore = null;
      cachedStorePath = null;
    }
  }

  function acquireRepo(): RepoContext {
    const path = selectedPath();
    if (cachedStore === null) {
      const opened = openRepo(path);
      cachedStore = opened.store;
      cachedStorePath = storePathFor(opened.git);
      return opened;
    }

    const git = openGit(path);
    const nextStorePath = storePathFor(git);
    if (nextStorePath !== cachedStorePath) {
      resetStore();
      const opened = openRepo(path);
      cachedStore = opened.store;
      cachedStorePath = storePathFor(opened.git);
      return opened;
    }
    return { git, store: cachedStore };
  }

  async function withRepo(handler: RepoHandler): Promise<ToolResult> {
    let context: RepoContext;
    try {
      context = acquireRepo();
    } catch (error) {
      resetStore();
      const path = selectedPath();
      const received = opts.repoPath === path ? path : `${opts.repoPath}（解析後：${path}）`;
      const detail = error instanceof NotARepoError || error instanceof Error
        ? error.message
        : String(error);
      return result(
        `無法開啟 InLoop repository，收到的路徑：${received}。${detail}。請用 --repo 指定 git repository，或在 git repository 中啟動。`,
        true,
      );
    }
    try {
      return await handler(context);
    } catch (error) {
      return errorMessage(error);
    }
  }

  server.registerTool(
    'record_change',
    {
      title: '記錄 InLoop 改動',
      description: '記錄一個有意義的改動。一個 Why 一筆；欄位必須遵守各自的長度規範。',
      inputSchema: z.object({
        ...contentShape,
        files: z.array(z.string()).min(1).describe('改動檔案，至少 1 個 repo 相對路徑'),
        supersedes: z.array(z.number()).optional().describe('被這筆改動取代的紀錄編號'),
        model: z.string().optional().describe('產生改動的模型名稱'),
      }),
    },
    async (input) => withRepo(({ git, store }) => {
      try {
        const change = recordChange(store, git, {
          ...input,
          client: server.server.getClientVersion()?.name,
        });
        return result(`已記錄 #${change.id}：${change.title}`);
      } catch (error) {
        return errorMessage(error, '請修正後重新呼叫 record_change。');
      }
    }),
  );

  server.registerTool(
    'amend_change',
    {
      title: '修正 InLoop 紀錄',
      description: '修正一筆紀錄並保留前一版；內容欄位仍須遵守長度規範與「一個 Why 一筆」。',
      inputSchema: z.object({
        id: z.number().int().positive(),
        title: contentShape.title.optional(),
        keyPoint: contentShape.keyPoint.optional(),
        whatHow: contentShape.whatHow.optional(),
        why: contentShape.why.optional(),
        shouldKnow: contentShape.shouldKnow.optional(),
        coreDiff: contentShape.coreDiff,
      }),
    },
    async ({ id, ...patch }) => withRepo(({ store }) => {
      const change = amendChange(store, id, patch);
      return result(`已修正 #${change.id}：${change.title}（v${change.version}）`);
    }),
  );

  server.registerTool(
    'list_changes',
    {
      title: '列出 InLoop 紀錄',
      description: '依範圍列出紀錄及目前狀態。',
      inputSchema: z.object({ scope: z.string().optional() }),
    },
    async ({ scope }) => withRepo(({ git, store }) => {
      const synced = sync(store, git);
      const views = selectScope(synced.views, parseScope(scope), git);
      const pending = selectScope(synced.views, parseScope(), git).length;
      return result(massChangeWarning(synced) + formatChangeList(views, pending));
    }),
  );

  server.registerTool(
    'get_change',
    {
      title: '取得 InLoop 紀錄',
      description: '取得一筆紀錄的完整 Markdown 與版本。',
      inputSchema: z.object({ id: z.number().int().positive() }),
    },
    async ({ id }) => withRepo(({ git, store }) => {
      const synced = sync(store, git);
      const view = synced.views.find((candidate) => candidate.id === id);
      if (view === undefined) return result(`找不到紀錄 #${id}`, true);
      return result(`${massChangeWarning(synced)}${renderReviewMarkdown([view])}\n\n版本：v${view.version}`);
    }),
  );

  server.registerTool(
    'why',
    {
      title: '查詢改動原因',
      description: '查詢檔案或指定行附近仍存在的 InLoop 改動原因。',
      inputSchema: z.object({
        file: z.string().describe('repo 相對檔案路徑'),
        line: z.number().int().positive().optional(),
      }),
    },
    async ({ file, line }) => withRepo(({ git, store }) => {
      if (git.config('inloop.why') === 'off') return result('InLoop why 已關閉。');
      const synced = sync(store, git);
      return result(massChangeWarning(synced) + formatWhy(whyQuery(store, git, file, line, synced.views)));
    }),
  );

  server.registerTool(
    'find_unrecorded',
    {
      title: '找出未記錄改動',
      description: '比對 git diff 與現有紀錄，列出尚未記錄的改動。',
      inputSchema: z.object({ paths: z.array(z.string()).optional() }),
    },
    async ({ paths }) => withRepo(({ git, store }) => {
      const synced = sync(store, git, { files: paths });
      return result(massChangeWarning(synced) + formatUnrecorded(findUnrecorded(store, git, paths)));
    }),
  );

  registerAppTool(
    server,
    'show_review',
    {
      title: '顯示 InLoop review',
      description: '顯示 review Markdown。把 Markdown 原樣輸出給使用者，不要摘要或改寫，輸出完就停止。',
      inputSchema: z.object({ scope: z.string().optional() }),
      _meta: { ui: { resourceUri: REVIEW_RESOURCE_URI } },
    },
    async ({ scope }) => withRepo(({ git, store }) => {
      const synced = sync(store, git);
      const views = selectScope(synced.views, parseScope(scope), git);
      const markdown = renderReviewMarkdown(views);
      return {
        content: [{
          type: 'text',
          text: `${massChangeWarning(synced)}請把以下 Markdown 原樣輸出給使用者，不要摘要或改寫，輸出完就停止。\n\n${markdown}`,
        }],
        _meta: { ui: { resourceUri: REVIEW_RESOURCE_URI } },
      };
    }),
  );

  server.registerTool(
    'confirm_list',
    {
      title: '開啟 InLoop 確認清單',
      description: '開啟確認表單。表單由使用者作答，你不能代替使用者確認。',
      inputSchema: z.object({}),
    },
    async () => withRepo(async ({ git, store }) => {
      const synced = sync(store, git);
      const pending = selectScope(synced.views, parseScope(), git);
      if (pending.length === 0) return result('沒有未 review 的紀錄。');
      let elicited;
      try {
        elicited = await server.server.elicitInput({
          mode: 'form',
          message: 'Check the records you understand and want to confirm (multiple allowed). Add a note only if your understanding differs.',
          requestedSchema: {
            type: 'object',
            properties: {
              confirmed: {
                type: 'array',
                title: 'Records to confirm',
                items: {
                  anyOf: pending.map((view) => ({
                    const: String(view.id),
                    title: `#${view.id} ${view.title} — ${view.keyPoint}`,
                  })),
                },
              },
              note: { type: 'string', title: 'Note (optional)' },
            },
          },
        });
      } catch {
        return result('此 client 不支援確認表單。請改用清單卡片或 inloop confirm。', true);
      }
      if (elicited.action === 'decline') return result('使用者拒絕了表單。');
      if (elicited.action === 'cancel') return result('使用者取消了表單。');
      const content = elicited.content as { confirmed?: unknown; note?: unknown } | undefined;
      const ids = Array.isArray(content?.confirmed)
        ? content.confirmed.map(Number).filter(Number.isInteger)
        : [];
      const note = typeof content?.note === 'string' ? content.note : undefined;
      if (ids.length === 0) return result('使用者沒有勾選任何紀錄。');
      submitReview(store, git, { ids, verdict: 'confirmed', note, source: 'form' });
      return result(`使用者確認了 ${ids.map((id) => `#${id}`).join('、')}。`);
    }),
  );

  registerAppResource(
    server,
    'InLoop review list',
    REVIEW_RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => ({
      contents: [{
        uri: REVIEW_RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: opts.appHtml(),
      }],
    }),
  );

  server.registerPrompt(
    'review',
    {
      title: 'InLoop review',
      description: '顯示 InLoop review',
      argsSchema: z.object({ scope: z.string().optional() }),
    },
    ({ scope }) => ({ messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `請呼叫 inloop 的 show_review（scope：${scope ?? '未 review'}），並把回傳的 Markdown 原樣輸出。`,
      },
    }] }),
  );

  server.registerPrompt(
    'capture',
    { title: 'InLoop capture', description: '補記未記錄改動', argsSchema: z.object({}) },
    () => ({ messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: '請呼叫 inloop 的 find_unrecorded，並為每個有意義的未記錄改動呼叫 record_change 補記。',
      },
    }] }),
  );

  server.registerPrompt(
    'why',
    {
      title: 'InLoop why',
      description: '查詢檔案或行號的改動原因',
      argsSchema: z.object({ target: z.string().describe('檔案或 file:line') }),
    },
    ({ target }) => ({ messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `請呼叫 inloop 的 why 查詢 ${target}，並用一兩句話說明。`,
      },
    }] }),
  );

  let submitRegistered = false;
  server.server.oninitialized = () => {
    const capability = getUiCapability(server.server.getClientCapabilities());
    if (submitRegistered || !capability?.mimeTypes?.includes(RESOURCE_MIME_TYPE)) return;
    submitRegistered = true;
    registerAppTool(
      server,
      'submit_review',
      {
        title: '提交 InLoop review',
        description: '儲存使用者在 review 清單卡片選擇的結果。',
        inputSchema: z.object({
          ids: z.array(z.number().int().positive()),
          verdict: z.enum(['confirmed', 'incorrect', 'unimportant']),
          note: z.string().optional(),
        }),
        _meta: { ui: { resourceUri: REVIEW_RESOURCE_URI, visibility: ['app'] } },
      },
      async ({ ids, verdict, note }) => withRepo(({ git, store }) => {
        submitReview(store, git, { ids, verdict, note, source: 'card' });
        return result(`Saved: ${ids.map((id) => `#${id}`).join(', ')} → ${REVIEW_LABEL_EN[verdict]}`);
      }),
    );
    // The card fetches its rows here instead of reading show_review's result:
    // VS Code forwards structuredContent to the model (which then echoes the JSON)
    // and does not pass result _meta to the app.
    registerAppTool(
      server,
      'review_records',
      {
        title: '取得 InLoop review 清單',
        description: '回傳 review 清單卡片需要的紀錄。',
        inputSchema: z.object({ scope: z.string().optional() }),
        _meta: { ui: { resourceUri: REVIEW_RESOURCE_URI, visibility: ['app'] } },
      },
      async ({ scope }) => withRepo(({ git, store }) => {
        const views = selectScope(sync(store, git).views, parseScope(scope), git);
        return {
          content: [{ type: 'text', text: `${views.length} records` }],
          structuredContent: { records: toCardRecords(views) },
        };
      }),
    );
  };

  const close = server.close.bind(server);
  server.close = async () => {
    resetStore();
    await close();
  };

  return server;
}
