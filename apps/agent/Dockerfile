# Lightweight agent Dockerfile - uses pre-built binary
FROM alpine:3.19

RUN apk add --no-cache openssh-server ca-certificates tzdata bash

WORKDIR /app
COPY bin/agent /app/agent

RUN mkdir -p /etc/ssh && \
    ssh-keygen -A && \
    sed -i 's/#PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config && \
    sed -i 's/#PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config && \
    mkdir -p /var/run/sshd

ENV AGENT_TOKEN=codepod-default
ENV AGENT_SANDBOX_ID=sandbox-dev
ENV AGENT_SERVER_URL=http://runner:8080

EXPOSE 22

ENTRYPOINT ["/app/agent"]
