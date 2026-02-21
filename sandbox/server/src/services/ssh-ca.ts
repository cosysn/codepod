/**
 * SSH Certificate Authority Service
 *
 * Implements SSH CA for certificate-based authentication using Ed25519:
 * - Server generates Ed25519 CA key pair using sshpk
 * - Server signs user public keys to create certificates using sshpk
 * - Agent trusts CA public key
 * - CLI generates Ed25519 keys and requests certificates
 */

import * as fs from 'fs';
import * as path from 'path';
import * as sshpk from 'sshpk';
import { logger } from '../logger';

interface CAKeys {
  publicKey: string;  // CA public key in OpenSSH format
  privateKey: sshpk.PrivateKey;  // CA private key
}

class SSHCAService {
  private caKeys: CAKeys | null = null;
  private caKeysPath: string;
  private caKeyPath: string;

  constructor(dataDir: string) {
    this.caKeysPath = path.join(dataDir, 'ssh-ca');       // Public key file
    this.caKeyPath = path.join(dataDir, 'ssh-ca-key');    // Private key file
  }

  /**
   * Initialize or load CA keys
   */
  async initialize(): Promise<void> {
    logger.info('[SSH-CA] Initializing with Ed25519 keys...');

    // Try to load existing CA keys
    if (fs.existsSync(this.caKeyPath) && fs.existsSync(this.caKeysPath)) {
      try {
        const publicKeyPem = fs.readFileSync(this.caKeysPath, 'utf-8');
        const privateKeyPem = fs.readFileSync(this.caKeyPath, 'utf-8');

        // Parse keys using sshpk
        const privateKey = sshpk.parsePrivateKey(privateKeyPem, 'pem');
        const publicKey = sshpk.parseKey(publicKeyPem, 'ssh');

        this.caKeys = {
          publicKey: publicKey.toString('ssh'),
          privateKey: privateKey as sshpk.PrivateKey,
        };

        logger.info('[SSH-CA] Loaded existing SSH CA keys (Ed25519)');
        return;
      } catch (e: any) {
        logger.warn('[SSH-CA] Failed to load existing CA keys: %s', e.message);
      }
    }

    // Generate new Ed25519 CA key pair
    await this.generateCAKeys();
  }

  /**
   * Generate new Ed25519 CA key pair using sshpk
   */
  private async generateCAKeys(): Promise<void> {
    logger.info('[SSH-CA] Generating new Ed25519 CA keys...');

    try {
      // Generate Ed25519 key pair using sshpk
      const privateKey = sshpk.generatePrivateKey('ed25519');
      const publicKey = privateKey.toPublic();

      // Save keys
      fs.writeFileSync(this.caKeyPath, privateKey.toString('pem'), { mode: 0o600 });
      fs.writeFileSync(this.caKeysPath, publicKey.toString('ssh'), { mode: 0o644 });

      this.caKeys = {
        publicKey: publicKey.toString('ssh'),
        privateKey: privateKey,
      };

      logger.info('[SSH-CA] Generated new Ed25519 CA keys');
    } catch (e: any) {
      logger.error('[SSH-CA] Failed to generate CA keys: %s', e.message);
      throw new Error(`Failed to generate CA keys: ${e.message}`);
    }
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
   * Sign a public key and return a certificate using sshpk
   */
  async signPublicKey(
    publicKeyPem: string,
    sandboxId: string,
    username: string = 'root',
    validitySeconds: number = 3600
  ): Promise<string> {
    logger.info('[SSH-CA] Signing public key for sandbox: %s', sandboxId);

    if (!this.caKeys) {
      throw new Error('SSH CA not initialized');
    }

    try {
      // Decode public key if base64 encoded
      let publicKeyContent = publicKeyPem;
      try {
        const decoded = Buffer.from(publicKeyPem, 'base64').toString('utf-8');
        if (decoded.includes('-----BEGIN')) {
          publicKeyContent = decoded;
        }
      } catch (e) {
        // Not base64, use as-is
      }

      // Parse the user public key using sshpk
      let userPublicKey: sshpk.Key;
      try {
        userPublicKey = sshpk.parseKey(publicKeyContent, 'ssh');
      } catch (e: any) {
        // Try parsing as PEM
        try {
          userPublicKey = sshpk.parseKey(publicKeyContent, 'pem');
        } catch (e2: any) {
          throw new Error(`Failed to parse public key: ${e2.message}`);
        }
      }

      logger.debug('[SSH-CA] User public key type: %s', userPublicKey.type);

      // Create certificate
      const now = new Date();
      const validAfter = Math.floor(now.getTime() / 1000) - 120;  // 2 minutes ago
      const validBefore = validAfter + validitySeconds;

      // Create issuer identity (the CA identity)
      const issuer = sshpk.identityForUser('root');

      // Create subject identity (the user identity)
      const subject = sshpk.identityForUser(username);

      // Create the certificate
      const certificate = sshpk.createCertificate(
        subject,
        userPublicKey,
        issuer,
        this.caKeys.privateKey,
        {
          validFrom: new Date(validAfter * 1000),
          validUntil: new Date(validBefore * 1000),
          serial: Buffer.from(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(16), 'hex'),
        }
      );

      // Sign the certificate with CA key
      certificate.signWith(this.caKeys.privateKey);

      // Return certificate in OpenSSH format
      const certStr = certificate.toString('openssh');
      logger.info('[SSH-CA] Certificate signed successfully');

      return certStr;
    } catch (e: any) {
      logger.error('[SSH-CA] Failed to sign certificate: %s', e.message);
      throw new Error(`Failed to sign certificate: ${e.message}`);
    }
  }
}

export const sshCAService = new SSHCAService(process.env.CODEPOD_DATA_DIR || './data');
