import { createMemoryHost } from '@jogpad/ui';

const demoMarkdown = `## Inbox

- [ ] https://github.com/ahkohd/tauri-nspanel
- [ ] A listen-only event tap cannot swallow keystrokes, which matters
  because swallowing Shift would break every capital letter.
- [x] Ask about the retry backoff in sync.ts

## Refactor

- [ ] Split the store module
`;

export const browserHost = createMemoryHost(demoMarkdown);
