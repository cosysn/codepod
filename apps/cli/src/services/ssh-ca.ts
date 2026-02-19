/**
 * SSH Certificate Service for CLI
 *
 * Handles generating Ed25519 key pairs and requesting certificates from Server
 */

import * as fs from 'fs';
import * as path from 'path';
import * as sshpk from 'sshpk';

const CLI_KEY_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '.',
  '.codepod',
  'keys'
);

export interface KeyPair {
  privateKey: string;
  publicKey: string;
  certificate?: string;
}

export class SSHCertificateService {
  private keyDir: string;

  constructor() {
    this.keyDir = CLI_KEY_DIR;
    if (!fs.existsSync(this.keyDir)) {
      fs.mkdirSync(this.keyDir, { recursive: true });
    }
  }

  /**
   * Generate a temporary Ed25519 key pair for sandbox access
   */
  generateKeyPair(sandboxId: string): KeyPair {
    const keyPath = path.join(this.keyDir, `${sandboxId}_ed25519`);

    // Generate Ed25519 key pair using sshpk
    const privateKeyObj = sshpk.generatePrivateKey('ed25519');
    const publicKey = privateKeyObj.toPublic();

    // Convert to OpenSSH format for server
    const opensshPrivateKey = privateKeyObj.toString('openssh');
    const opensshPublicKey = publicKey.toString('openssh');

    // Save OpenSSH private key
    fs.writeFileSync(keyPath, opensshPrivateKey, { mode: 0o600 });

    // Save public key
    fs.writeFileSync(`${keyPath}.pub`, opensshPublicKey);

    return { privateKey: opensshPrivateKey, publicKey: opensshPublicKey };
  }

  /**
   * Request certificate from Server
   */
  async requestCertificate(
    sandboxId: string,
    serverUrl: string,
    apiKey?: string
  ): Promise<string> {
    const publicKeyPath = path.join(this.keyDir, `${sandboxId}_ed25519.pub`);
    const publicKey = fs.readFileSync(publicKeyPath, 'utf-8');

    // Use base64 encoding to avoid JSON escape issues with newlines
    const publicKeyBase64 = Buffer.from(publicKey).toString('base64');

    const response = await fetch(`${serverUrl}/api/v1/ssh/cert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey && { 'X-API-Key': apiKey }),
      },
      body: JSON.stringify({
        publicKey: publicKeyBase64,
        sandboxId,
        validitySeconds: 3600, // 1 hour
      }),
    });

    if (!response.ok) {
      const error = await response.json() as { message?: string };
      throw new Error(error.message || 'Failed to get certificate');
    }

    const result = await response.json() as { certificate: string };

    // Save certificate
    const certPath = path.join(this.keyDir, `${sandboxId}_ed25519-cert.pub`);
    fs.writeFileSync(certPath, result.certificate);

    return result.certificate;
  }

  /**
   * Get certificate for sandbox
   */
  getCertificatePath(sandboxId: string): string | null {
    const certPath = path.join(this.keyDir, `${sandboxId}_ed25519-cert.pub`);
    return fs.existsSync(certPath) ? certPath : null;
  }

  /**
   * Get private key for sandbox
   */
  getPrivateKeyPath(sandboxId: string): string | null {
    const keyPath = path.join(this.keyDir, `${sandboxId}_ed25519`);
    return fs.existsSync(keyPath) ? keyPath : null;
  }

  /**
   * Check if we have valid credentials for sandbox
   */
  hasCertificate(sandboxId: string): boolean {
    const keyPath = this.getPrivateKeyPath(sandboxId);
    const certPath = this.getCertificatePath(sandboxId);
    return keyPath !== null && certPath !== null;
  }
}

export const sshCertService = new SSHCertificateService();
