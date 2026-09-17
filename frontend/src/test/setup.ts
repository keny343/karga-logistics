import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

/**
 * jsdom has no viewport, so it has no scrolling. Components that move the page - to bring a
 * refused delivery's proof panel into view, for instance - would otherwise fail on a missing
 * method rather than on anything the test is about. Stubbed here instead of guarded in the
 * components, because the gap belongs to the environment and not to the product.
 */
Element.prototype.scrollIntoView = vi.fn();
