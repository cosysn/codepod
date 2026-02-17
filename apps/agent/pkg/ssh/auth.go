package ssh

import (
	"fmt"

	"golang.org/x/crypto/ssh"
)

type serverPasswordAuth struct {
	token string
}

func (a *serverPasswordAuth) Authenticate(conn ssh.ConnMetadata, password []byte) (*ssh.Permissions, error) {
	if string(password) == a.token {
		return &ssh.Permissions{}, nil
	}
	return nil, fmt.Errorf("invalid token")
}
