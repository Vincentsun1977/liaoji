(function () {
  'use strict';

  window.ChatRestoreSettings = {
    DEFAULT_CLOUD_API_BASE_URL: 'https://liaoji-cloud.onrender.com',
    DEFAULT_SUPABASE_URL: 'https://eadbqbxrdfnzqsggzmlh.supabase.co',
    DEFAULT_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVhZGJxYnhyZGZuenFzZ2d6bWxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMDMwNTQsImV4cCI6MjA5MjY3OTA1NH0.yTM79mlvJVgIBw9K2JXA4bUkulUaEDXqG4FcavsFuO4',
    DEFAULT_AI_PROMPT: [
      '你是一位知识库笔记整理专家。请把聊天记录重新整理成适合 Obsidian/Notion 保存的 Markdown 知识笔记。',
      '要求：',
      '1. 只输出标准 Markdown 正文，不要把整篇内容包在 ```markdown 代码围栏中。',
      '2. 不要输出 YAML frontmatter；正文从 # 标题开始。',
      '3. 保留事实、结论、关键步骤、代码、命令、链接、限制条件和注意事项。',
      '4. 删除寒暄、重复表达、无价值的轮次和冗余解释。',
      '5. 改善标题层级、列表、表格、语法和表达，让内容更像可复用的知识库文章。',
      '6. 当内容包含分类、对比、参数、步骤状态或优先级时，优先使用 GitHub Flavored Markdown 表格。',
      '7. 只输出 Markdown，不要输出额外说明。'
    ].join('\n'),
    DEFAULT_SYNC: {
      obsidianVault: '',
      obsidianFolder: 'AI Chats',
      obsidianOverwrite: true,
      aiSummaryEnabled: false,
      aiProvider: 'minimax',
      aiSummaryStyle: 'knowledge',
    },
    DEFAULT_LOCAL: {},
  };
})();
