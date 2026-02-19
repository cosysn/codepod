/**
 * SSH Certificate Service for CLI
 *
 * Handles generating key pairs and requesting certificates from Server
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

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

    // Generate private key
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });

    // Save private key
    fs.writeFileSync(keyPath, privateKey);
    fs.chmodSync(keyPath, 0o600);

    // Save public key
    fs.writeFileSync(`${keyPath}.pub`, publicKey);

    return { privateKey, publicKey };
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

    const response = await fetch(`${serverUrl}/api/v1/ssh/cert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey && { 'X-API-Key': apiKey }),
      },
      body: JSON.stringify({
        publicKey,
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
