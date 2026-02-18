import { PTYService } from './pty';

describe('PTYService', () => {
  it('should create PTY instance', () => {
    const service = new PTYService();
    expect(service).toBeDefined();
  });
});
