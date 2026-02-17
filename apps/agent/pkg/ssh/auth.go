package ssh

import (
	"crypto/subtle"
	"fmt"

	"golang.org/x/crypto/ssh"
)

type serverPasswordAuth struct {
	token string
}

func (a *serverPasswordAuth) Authenticate(conn ssh.ConnMetadata, password []byte) (*ssh.Permissions, error) {
	if subtle.ConstantTimeCompare(password, []byte(a.token)) == 1 {
		return &ssh.Permissions{}, nil
	}
	return nil, fmt.Errorf("invalid token")
}
