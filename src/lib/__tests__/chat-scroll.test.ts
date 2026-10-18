import { isChatAtLatest } from '../chat-scroll';

describe('chat history follow behavior', () => {
  it('follows new messages when already at the bottom or in a short conversation', () => {
    expect(isChatAtLatest(300, 700, 1000, 24)).toBe(true);
    expect(isChatAtLatest(600, 0, 200, 24)).toBe(true);
    expect(isChatAtLatest(300, 680, 1000, 24)).toBe(true);
  });

  it('keeps the reader positioned when browsing older history', () => {
    expect(isChatAtLatest(300, 500, 1000, 24)).toBe(false);
    expect(isChatAtLatest(300, 675, 1000, 24)).toBe(false);
  });
});
