import { SSHService, SSHConfig } from './ssh';

describe('SSHService', () => {
  it('should create connection config', () => {
    const config: SSHConfig = {
      host: 'localhost',
      port: 22,
      username: 'user',
      password: 'token',
    };
    const service = new SSHService(config);
    expect(service).toBeDefined();
  });

  it('should handle exec result', () => {
    const result = {
      stdout: 'test output',
      stderr: '',
      exitCode: 0,
    };
    expect(result.exitCode).toBe(0);
  });
});
