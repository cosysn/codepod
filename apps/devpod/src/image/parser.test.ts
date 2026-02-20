import { ImageParser } from './parser';

describe('ImageParser', () => {
  let parser: ImageParser;

  beforeEach(() => {
    parser = new ImageParser();
  });

  test('should parse simple image with tag', () => {
    const result = parser.parse('python:3.11');
    expect(result.registry).toBe('docker.io');
    expect(result.repository).toBe('python');
    expect(result.tag).toBe('3.11');
  });

  test('should parse image with registry', () => {
    const result = parser.parse('localhost:5000/my-app:v1');
    expect(result.registry).toBe('localhost:5000');
    expect(result.repository).toBe('my-app');
    expect(result.tag).toBe('v1');
  });

  test('should parse image without tag (default to latest)', () => {
    const result = parser.parse('python');
    expect(result.registry).toBe('docker.io');
    expect(result.repository).toBe('python');
    expect(result.tag).toBe('latest');
  });

  test('should parse complex image path', () => {
    const result = parser.parse('gcr.io/my-project/my-app:v2');
    expect(result.registry).toBe('gcr.io');
    expect(result.repository).toBe('my-project/my-app');
    expect(result.tag).toBe('v2');
  });

  test('should build fullName from parts', () => {
    expect(parser.parse('localhost:5000/my-app:v1').fullName).toBe('localhost:5000/my-app:v1');
    expect(parser.parse('python:3.11').fullName).toBe('python:3.11');
    expect(parser.parse('python').fullName).toBe('python:latest');
    expect(parser.parse('gcr.io/my-project/my-app:v2').fullName).toBe('gcr.io/my-project/my-app:v2');
  });
});
