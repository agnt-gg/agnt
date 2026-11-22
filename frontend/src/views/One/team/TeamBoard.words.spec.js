// The board tells people from assistants, and says what a working assistant is doing.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'TeamBoard.vue'), 'utf8');

describe('the team board', () => {
  it('tags a card an assistant holds as AI', () => {
    expect(SRC).toContain(`<span v-if="t.assignee && t.assignee.kind === 'agent'" class="tag violet" data-testid="card-ai">AI</span>`);
  });
  it('says Working on it and + Add card', () => {
    expect(SRC).toContain('<span class="pulse"></span>Working on it</template>');
    expect(SRC).toContain('>+ Add card</button>');
  });
});
