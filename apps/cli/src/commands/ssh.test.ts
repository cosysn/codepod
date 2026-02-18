import { sshCommand } from './ssh';

describe('ssh command', () => {
  it('should create ssh command', () => {
    const cmd = sshCommand();
    expect(cmd.name()).toBe('ssh <id>');
    expect(cmd.description()).toContain('SSH');
  });
});
