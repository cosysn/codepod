# Build stage
FROM golang:1.21-alpine AS builder

RUN apk add --no-cache git

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -o envbuilder ./cmd

# Runtime stage
FROM alpine:3.19

RUN apk add --no-cache \
    ca-certificates \
    tzdata \
    bash \
    docker \
    curl

# Copy kaniko
COPY --from=gcr.io/kaniko-project/executor:latest /kaniko /kaniko

# Copy envbuilder
COPY --from=builder /build/envbuilder /usr/local/bin/envbuilder

WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/envbuilder"]
CMD ["--help"]
