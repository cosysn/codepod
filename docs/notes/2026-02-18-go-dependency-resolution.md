# Go Dependency Resolution Notes

## Problem

The environment has network restrictions that prevent downloading Go modules from standard sources (`proxy.golang.org`, `sum.golang.org`, and `google.golang.org`).

## Solution

### 1. Set Go Proxy to Aliyun Mirror

```bash
go env -w GOPROXY=https://mirrors.aliyun.com/goproxy/,direct
```

### 2. Disable SumDB Verification

Some versions of modules may not be available in the checksum database:

```bash
GOSUMDB=off go mod tidy
```

Or for specific package fetches:

```bash
GOSUMDB=off go get github.com/docker/distribution/reference@latest
```

### 3. Pin Toolchain Versions

When dependencies require newer Go versions, pin the `golang.org/x/time` package to avoid toolchain upgrades:

```bash
GOSUMDB=off go get golang.org/x/time@v0.5.0
```

### 4. Docker SDK Version Compatibility

Docker SDK v24.x may have incompatibility issues with the distribution package. Use Docker v23.x:

```bash
GOSUMDB=off go get github.com/docker/docker@v23.0.0
```

Then run:

```bash
GOSUMDB=off go mod tidy
```

## Complete Workflow

```bash
# 1. Set proxy
go env -w GOPROXY=https://mirrors.aliyun.com/goproxy/,direct

# 2. Add specific packages if needed
GOSUMDB=off go get github.com/docker/docker@v23.0.0
GOSUMDB=off go get golang.org/x/time@v0.5.0

# 3. Tidy dependencies
GOSUMDB=off go mod tidy

# 4. Build and test
go build ./...
go test ./...
```

## Working go.mod Configuration

```go
require github.com/docker/docker v23.0.0+incompatible

require (
    github.com/docker/distribution v2.8.1+incompatible
    github.com/docker/go-connections v0.6.0
    github.com/docker/go-units v0.5.0
    golang.org/x/time v0.5.0
)
```
