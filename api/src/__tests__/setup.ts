// Common test setup — mock Drizzle db instance for unit tests
import { vi } from 'vitest';

vi.mock('../db/index.ts', () => {
  // Chainable mock builder: each method returns the mock itself,
  // except terminal methods which resolve the promise.
  function createChainableMock() {
    const mock: any = vi.fn(() => mock);
    // Chain methods
    for (const method of [
      'select', 'insert', 'update', 'delete',
      'from', 'where', 'set', 'values',
      'returning', 'innerJoin', 'leftJoin',
      'orderBy', 'limit', 'offset', 'groupBy',
      'onConflictDoUpdate', 'onConflictDoNothing',
      'as',
    ]) {
      mock[method] = vi.fn(() => mock);
    }
    // Terminal: make mock thenable so `await db.select()...` works
    mock.then = undefined; // will be set per-test via mockResolvedValue
    mock.execute = vi.fn();
    return mock;
  }

  return { db: createChainableMock() };
});
