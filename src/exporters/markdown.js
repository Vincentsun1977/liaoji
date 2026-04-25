(function () {
  'use strict';

  window.ChatRestoreMarkdown = {
    buildMarkdown,
    buildAiSummaryMarkdown,
    buildFilename,
    buildConversationId,
  };

  function buildMarkdown(chat) {
    const title = clean(chat.title) || 'AI Chat Note';
    const platform = clean(chat.platform) || 'Unknown';
    const exportedAt = new Date().toISOString();
    const conversationId = buildConversationId(chat);
    const sourceUrl = clean(chat.url);
    const messages = Array.isArray(chat.messages) ? chat.messages : [];

    const lines = [
      '---',
      `title: ${yamlString(title)}`,
      `source_platform: ${yamlString(platform)}`,
      `source_conversation_id: ${yamlString(conversationId)}`,
      `source_url: ${yamlString(sourceUrl)}`,
      `exported_at: ${yamlString(exportedAt)}`,
      `last_synced_at: ${yamlString(exportedAt)}`,
      'tags:',
      '  - ai-chat',
      `  - ${tagify(platform)}`,
      '---',
      '',
      `# ${title}`,
      '',
      '| Field | Value |',
      '| --- | --- |',
      `| Platform | ${escapeTable(platform)} |`,
      `| Conversation ID | ${escapeTable(conversationId)} |`,
      `| Source | ${escapeTable(sourceUrl || 'Unavailable')} |`,
      `| Last synced | ${escapeTable(exportedAt)} |`,
      `| Messages | ${messages.length} |`,
      '',
      '## Conversation',
      '',
      '<!-- chat_restore_note:conversation:start -->',
      '',
    ];

    messages.forEach((message, index) => {
      const role = normalizeRole(message.role);
      const content = clean(message.content);
      if (!content) return;
      lines.push(`### ${index + 1}. ${role}`);
      lines.push('');
      lines.push(content);
      lines.push('');
    });

    if (!messages.length) {
      lines.push('No messages were extracted from the current page.');
      lines.push('');
    }

    lines.push('<!-- chat_restore_note:conversation:end -->');
    lines.push('');

    return lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trimEnd() + '\n';
  }

  function buildAiSummaryMarkdown(chat, summaryMarkdown) {
    const title = clean(chat.title) || 'AI Chat Note';
    const platform = clean(chat.platform) || 'Unknown';
    const exportedAt = new Date().toISOString();
    const conversationId = buildConversationId(chat);
    const sourceUrl = clean(chat.url);
    const summary = clean(summaryMarkdown);

    const lines = [
      '---',
      `title: ${yamlString(title)}`,
      `source_platform: ${yamlString(platform)}`,
      `source_conversation_id: ${yamlString(conversationId)}`,
      `source_url: ${yamlString(sourceUrl)}`,
      `exported_at: ${yamlString(exportedAt)}`,
      `last_synced_at: ${yamlString(exportedAt)}`,
      'summary_type: "ai"',
      'tags:',
      '  - ai-chat',
      `  - ${tagify(platform)}`,
      '  - ai-summary',
      '---',
      '',
      '<!-- chat_restore_note:summary:start -->',
      '',
      summary || `# ${title}`,
      '',
      '<!-- chat_restore_note:summary:end -->',
      '',
    ];

    return lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trimEnd() + '\n';
  }

  function buildFilename(chat, options = {}) {
    const platform = clean(chat.platform) || 'chat';
    const title = clean(chat.title) || 'conversation';
    const id = buildConversationId(chat).slice(0, 8);
    const suffix = options.copy ? `-copy-${timestamp()}` : '';
    const base = `${platform}-${title}-${id}${suffix}`
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 145);
    return `${base || 'chat-note'}.md`;
  }

  function buildConversationId(chat) {
    const sourceUrl = clean(chat?.url);
    const urlId = extractUrlId(sourceUrl);
    if (urlId) return urlId;

    const basis = `${clean(chat?.platform)}|${clean(chat?.title)}|${sourceUrl}`;
    return `local-${hashString(basis)}`;
  }

  function extractUrlId(sourceUrl) {
    try {
      const url = new URL(sourceUrl);
      const parts = url.pathname.split('/').filter(Boolean);
      const markerIndex = parts.findIndex((part) => ['c', 'chat'].includes(part));
      if (markerIndex >= 0 && parts[markerIndex + 1]) return parts[markerIndex + 1];
      return parts[parts.length - 1] || '';
    } catch (_error) {
      return '';
    }
  }

  function normalizeRole(role) {
    const value = clean(role).toLowerCase();
    if (['user', 'human', 'me'].includes(value)) return 'User';
    if (['assistant', 'model', 'ai', 'claude', 'chatgpt', 'gemini', 'deepseek'].includes(value)) return 'Assistant';
    if (value === 'system') return 'System';
    return role ? titleCase(role) : 'Message';
  }

  function yamlString(value) {
    return JSON.stringify(String(value || ''));
  }

  function tagify(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'chat';
  }

  function escapeTable(value) {
    return clean(value).replace(/\|/g, '\\|').replace(/\n+/g, '<br>');
  }

  function clean(value) {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
  }

  function titleCase(value) {
    const text = clean(value);
    return text ? text[0].toUpperCase() + text.slice(1) : '';
  }

  function hashString(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function timestamp() {
    return new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  }
})();
