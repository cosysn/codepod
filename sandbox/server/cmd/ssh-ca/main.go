//go:build ignore
// +build ignore

// SSH Certificate Authority tool for signing user certificates
package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/crypto/ssh"
)

func main() {
	if len(os.Args) < 6 {
		fmt.Fprintf(os.Stderr, "Usage: %s <data-dir> <public-key> <sandbox-id> <username> <validity-seconds>\n", os.Args[0])
		os.Exit(1)
	}

	dataDir := os.Args[1]
	publicKeyPEM := os.Args[2]
	sandboxId := os.Args[3]
	username := os.Args[4]
	validitySeconds := 3600
	fmt.Sscanf(os.Args[5], "%d", &validitySeconds)

	// Load or generate CA keys
	caKeyPath := filepath.Join(dataDir, "ssh-ca-key")
	caCertPath := filepath.Join(dataDir, "ssh-ca")

	var caKey ssh.Signer
	var caPublicKey ssh.PublicKey

	if _, err := os.Stat(caKeyPath); os.IsNotExist(err) {
		// Generate new RSA CA key
		fmt.Println("Generating new CA key...")
		rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			log.Fatalf("Failed to generate CA key: %v", err)
		}

		// Save private key
		privateKeyPEM := pem.EncodeToMemory(&pem.Block{
			Type:  "RSA PRIVATE KEY",
			Bytes: x509.MarshalPKCS1PrivateKey(rsaKey),
		})
		if err := os.WriteFile(caKeyPath, privateKeyPEM, 0600); err != nil {
			log.Fatalf("Failed to save CA key: %v", err)
		}

		// Create signer and public key
		caKey, err = ssh.NewSignerFromKey(rsaKey)
		if err != nil {
			log.Fatalf("Failed to create signer: %v", err)
		}
		caPublicKey = caKey.PublicKey()

		// Save public key in OpenSSH format
		if err := os.WriteFile(caCertPath, []byte(ssh.MarshalAuthorizedKey(caPublicKey)), 0644); err != nil {
			log.Fatalf("Failed to save CA cert: %v", err)
		}
		fmt.Println("CA keys generated successfully")
	} else {
		// Load existing CA key
		fmt.Println("Loading existing CA key...")
		privateKeyPEM, err := os.ReadFile(caKeyPath)
		if err != nil {
			log.Fatalf("Failed to read CA key: %v", err)
		}

		key, err := ssh.ParsePrivateKey(privateKeyPEM)
		if err != nil {
			log.Fatalf("Failed to parse CA key: %v", err)
		}
		caKey = key
		caPublicKey = key.PublicKey()

		// Ensure public key file exists
		if _, err := os.Stat(caCertPath); os.IsNotExist(err) {
			if err := os.WriteFile(caCertPath, []byte(ssh.MarshalAuthorizedKey(caPublicKey)), 0644); err != nil {
				log.Fatalf("Failed to save CA cert: %v", err)
			}
		}
	}

	// Parse the public key to sign
	var pubKey ssh.PublicKey

	// Try base64 decoded first
	decodedPublicKey, err := base64.StdEncoding.DecodeString(publicKeyPEM)
	if err == nil {
		pubKey, err = ssh.ParsePublicKey(decodedPublicKey)
		if err != nil {
			// Try OpenSSH format
			pubKey, _, _, _, err = ssh.ParseAuthorizedKey([]byte(publicKeyPEM))
			if err != nil {
				log.Fatalf("Failed to parse public key: %v", err)
			}
		}
	} else {
		// Try PEM format first
		pubKey, err = ssh.ParsePublicKey([]byte(publicKeyPEM))
		if err != nil {
			// Try OpenSSH format
			pubKey, _, _, _, err = ssh.ParseAuthorizedKey([]byte(publicKeyPEM))
			if err != nil {
				log.Fatalf("Failed to parse public key: %v", err)
			}
		}
	}

	// Generate random serial
	serial := uint64(time.Now().UnixNano())

	// Create certificate
	now := time.Now()
	cert := &ssh.Certificate{
		KeyId:           sandboxId,
		Serial:          serial,
		CertType:        ssh.UserCert,
		ValidAfter:      uint64(now.Add(-2 * time.Minute).Unix()), // 2 min tolerance for clock sync
		ValidBefore:     uint64(now.Add(time.Duration(validitySeconds) * time.Second).Unix()),
		Key:             pubKey,
		ValidPrincipals: []string{username},
	}

	// Sign the certificate
	if err := cert.SignCert(rand.Reader, caKey); err != nil {
		log.Fatalf("Failed to sign certificate: %v", err)
	}

	// Output the certificate in OpenSSH format
	certPEM := ssh.MarshalAuthorizedKey(cert)
	fmt.Print(string(certPEM))
}
