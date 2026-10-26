// Loads jest-dom matchers (toBeInTheDocument, …) into every test file.
import '@testing-library/jest-dom/vitest';

// Node-env tests have no HTMLMediaElement; jsdom never plays media.
if (typeof HTMLMediaElement !== 'undefined') {
  HTMLMediaElement.prototype.play = () => Promise.resolve();
}