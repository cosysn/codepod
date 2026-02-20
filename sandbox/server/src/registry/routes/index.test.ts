/**
 * Unit tests for registry routes index
 */

describe('Registry Routes Index', () => {
  test('should export all routers', () => {
    const { imagesRouter, tagsRouter, v2Router } = require('./index');
    expect(imagesRouter).toBeDefined();
    expect(tagsRouter).toBeDefined();
    expect(v2Router).toBeDefined();
  });
});
