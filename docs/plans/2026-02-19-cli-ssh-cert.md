# CLI SSH Certificate Authentication Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement SSH certificate-based authentication in CLI for secure, password-less sandbox access

**Architecture:** CLI generates temporary Ed25519 key pair, requests Server to sign it with CA, then uses certificate to authenticate with sandbox via SSH.

**Tech Stack:** TypeScript, ssh2 library, OpenSSL/ssh-keygen

---

## Plan

### Task 1: Create SSH certificate service for CLI

**Files:**
- Modify: `apps/cli/src/services/ssh.ts`
- Create: `apps/cli/src/services/ssh-ca.ts`

**Step 1: Create ssh-ca.ts with certificate utilities**

```typescript
// apps/cli/src/services/ssh-ca.ts

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface KeyPair {
  privateKey: string;
  publicKey: string;
  certificate?: string;
}

const CLI_KEY_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.codepod', 'keys');

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
      const error = await response.json();
      throw new Error(error.message || 'Failed to get certificate');
    }

    const { certificate } = await response.json();

    // Save certificate
    const certPath = path.join(this.keyDir, `${sandboxId}_ed25519-cert.pub`);
    fs.writeFileSync(certPath, certificate);

    return certificate;
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
}

export const sshCertService = new SSHCertificateService();
```

**Step 2: Run to verify it compiles**

Expected: No errors

**Step 3: Add to ssh.ts service**

Modify `apps/cli/src/services/ssh.ts` to use certificate authentication:

```typescript
// Add after existing imports
import { sshCertService } from './ssh-ca';

// Modify connectSandbox method
async connectSandbox(id: string, command?: string): Promise<void> {
  const sandbox = store.getSandbox(id);
  if (!sandbox) {
    throw new Error('Sandbox not found');
  }

  const config = loadConfig();
  const port = sandbox.port || 2222;

  // Try certificate auth first
  const privateKeyPath = sshCertService.getPrivateKeyPath(id);
  const certPath = sshCertService.getCertificatePath(id);

  if (privateKeyPath && certPath) {
    // Use certificate authentication
    await this.connectWithCert(
      sandbox.host,
      port,
      'root',
      privateKeyPath,
      certPath,
      command
    );
  } else {
    // Fall back to token/password auth
    const token = sandbox.token;
    if (!token) {
      throw new Error('No authentication method available');
    }
    await this.connectWithPassword(
      sandbox.host,
      port,
      'root',
      token,
      command
    );
  }
}

private async connectWithCert(
  host: string,
  port: number,
  user: string,
  privateKeyPath: string,
  certPath: string,
  command?: string
): Promise<void> {
  // Implementation using ssh2 with certificate
}
```

**Step 4: Run test**

Expected: TypeScript compiles without errors

---

### Task 2: Update Agent to validate certificates

**Files:**
- Modify: `apps/agent/pkg/ssh/server.go`

**Step 1: Implement proper certificate validation**

```go
// In handleConnection, replace the PublicKeyCallback with:

PublicKeyCallback: func(conn ssh.ConnMetadata, key ssh.PublicKey) (*ssh.Permissions, error) {
    // Verify it's a certificate
    cert, ok := key.(*ssh.Certificate)
    if !ok {
        return nil, fmt.Errorf("expected certificate, got public key")
    }

    // Check certificate type (user certificate)
    if cert.CertType != ssh.UserCert {
        return nil, fmt.Errorf("expected user certificate, got %v", cert.CertType)
    }

    // Check validity period
    now := time.Now()
    if uint64(now.Unix()) < cert.ValidAfter {
        return nil, fmt.Errorf("certificate not yet valid")
    }
    if uint64(now.Unix()) > cert.ValidBefore {
        return nil, fmt.Errorf("certificate has expired")
    }

    // Log certificate info
    log.Printf("Certificate from %s: serial=%d, login_as=%s",
        conn.User(), cert.Serial, cert.KeyId)

    return &ssh.Permissions{
        CriticalOptions: cert.CriticalOptions,
        Extensions:     cert.Extensions,
    }, nil
}
```

**Step 2: Run test**

Expected: `go build` succeeds

---

### Task 3: Update Runner to use ssh-keygen for host keys

**Files:**
- Modify: `apps/runner/pkg/sandbox/manager.go`

**Step 1: Generate host keys properly using ssh-keygen**

```go
// Replace generateAndCopySSHHostKeys with:

func (m *Manager) generateAndCopySSHHostKeys(ctx context.Context, containerID string) error {
    // Create temp directory for keys
    tmpDir, err := os.MkdirTemp("", "ssh-keys-")
    if err != nil {
        return fmt.Errorf("failed to create temp dir: %w", err)
    }
    defer os.RemoveAll(tmpDir)

    // Generate host keys using ssh-keygen
    keygen := exec.Command("ssh-keygen", "-A", "-f", tmpDir)
    if err := keygen.Run(); err != nil {
        return fmt.Errorf("failed to generate host keys: %w", err)
    }

    // Copy each key to container
    keys := []string{
        "ssh_host_rsa_key",
        "ssh_host_ecdsa_key",
        "ssh_host_ed25519_key",
    }

    for _, key := range keys {
        keyPath := path.Join(tmpDir, key)
        keyPubPath := path.Join(tmpDir, key+".pub")

        // Copy private key
        if data, err := os.ReadFile(keyPath); err == nil {
            m.docker.CopyFileToContainer(ctx, containerID, "/etc/ssh/"+key, bytes.NewReader(data))
        }

        // Copy public key
        if data, err := os.ReadFile(keyPubPath); err == nil {
            m.docker.CopyFileToContainer(ctx, containerID, "/etc/ssh/"+key+".pub", bytes.NewReader(data))
        }
    }

    return nil
}
```

**Step 2: Run test**

Expected: `go build` succeeds

---

### Task 4: Build and test end-to-end

**Step 1: Build all components**

```bash
cd apps/cli && npm run build
cd apps/server && npm run build
cd apps/runner && go build
cd apps/agent && go build
```

**Step 2: Rebuild Docker images**

```bash
cd docker && docker-compose build
```

**Step 3: Test workflow**

```bash
# Create sandbox
./dist/index.js create python:3.11

# Get certificate
./dist/index.js ssh <sandbox-id> --get-cert

# SSH with certificate
./dist/index.js ssh <sandbox-id>
```

**Expected: Certificate-based SSH works without password**

---

### Task 5: Commit

```bash
git add -A
git commit -m "feat: implement CLI SSH certificate authentication"
```
