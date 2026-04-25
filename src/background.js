chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'DOWNLOAD_MARKDOWN') {
    downloadMarkdown(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Download failed.' }));
    return true;
  }
});

async function downloadMarkdown(message) {
  const content = String(message.content || '');
  if (!content.trim()) throw new Error('Markdown content is empty.');

  const filename = sanitizeFilename(message.filename || 'chat-note.md');
  const dataUrl = `data:text/markdown;charset=utf-8,${encodeURIComponent(content)}`;

  await chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: true,
  });

  return { ok: true };
}

function sanitizeFilename(value) {
  const cleaned = String(value)
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

  return cleaned.endsWith('.md') ? cleaned : `${cleaned || 'chat-note'}.md`;
}
