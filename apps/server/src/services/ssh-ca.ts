/**
 * SSH Certificate Authority Service
 *
 * Implements SSH CA for certificate-based authentication:
 * - Server acts as CA, signs client certificates
 * - Agent trusts CA public key
 * - CLI generates keys and requests certificates
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as sshpk from 'sshpk';

// Simple in-memory CA key storage
interface CAKeys {
  publicKey: string;  // CA public key in OpenSSH format
  privateKey: string; // CA private key
}

class SSHCAService {
  private caKeys: CAKeys | null = null;
  private caKeysPath: string;

  constructor(dataDir: string) {
    this.caKeysPath = path.join(dataDir, 'ssh-ca');
  }

  /**
   * Initialize or load CA keys
   */
  async initialize(): Promise<void> {
    // Try to load existing keys
    if (fs.existsSync(this.caKeysPath)) {
      try {
        const keys = JSON.parse(fs.readFileSync(this.caKeysPath, 'utf-8'));
        this.caKeys = {
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
        };
        console.log('Loaded existing SSH CA keys');
        return;
      } catch (e) {
        console.warn('Failed to load SSH CA keys, generating new ones');
      }
    }

    // Generate new CA keys
    await this.generateCAKeys();
  }

  /**
   * Generate new CA key pair (Ed25519)
   */
  private async generateCAKeys(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Generate Ed25519 key pair
      crypto.generateKeyPair('ed25519', {
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem'
        },
        privateKeyEncoding: {
          type: 'pkcs8',
          format: 'pem'
        }
      }, (err, publicKey, privateKey) => {
        if (err) {
          reject(err);
          return;
        }

        // Convert to OpenSSH format
        try {
          const publicKeyObj = sshpk.parseKey(publicKey, 'pem');
          const opensshPublicKey = publicKeyObj.toString('openssh');

          const privateKeyObj = sshpk.parseKey(privateKey, 'pem');
          const opensshPrivateKey = privateKeyObj.toString('openssh');

          this.caKeys = {
            publicKey: opensshPublicKey,
            privateKey: opensshPrivateKey,
          };

          // Save to file
          const dir = path.dirname(this.caKeysPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(this.caKeysPath, JSON.stringify(this.caKeys, null, 2));

          console.log('Generated new SSH CA keys');
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  /**
   * Get CA public key (for agent configuration)
   */
  getCAPublicKey(): string {
    if (!this.caKeys) {
      throw new Error('SSH CA not initialized');
    }
    return this.caKeys.publicKey;
  }

  /**
   * Sign a public key and return a certificate
   */
  async signPublicKey(
    publicKeyPem: string,
    sandboxId: string,
    username: string = 'root',
    validitySeconds: number = 3600 // 1 hour default
  ): Promise<string> {
    if (!this.caKeys) {
      throw new Error('SSH CA not initialized');
    }

    try {
      // Parse the public key from client (auto-detect format)
      const publicKey = sshpk.parseKey(publicKeyPem);

      // Parse CA private key
      const caPrivateKey = sshpk.parsePrivateKey(this.caKeys.privateKey, 'openssh');

      // Create identity for the user
      const identity = sshpk.identityForUser(username);

      // Create certificate (signs automatically with caPrivateKey)
      const cert = sshpk.createCertificate(identity, caPrivateKey, identity, caPrivateKey);

      // Set certificate validity
      const now = new Date();
      const expires = new Date(now.getTime() + validitySeconds * 1000);
      cert.validFrom = now;
      cert.validUntil = expires;

      // Return certificate in OpenSSH format
      return cert.toString('openssh');
    } catch (e) {
      throw new Error(`Failed to sign certificate: ${e}`);
    }
  }
}

export const sshCAService = new SSHCAService(process.env.CODEPOD_DATA_DIR || './data');
