# CodePod 重构设计：将 apps 目录重命名为 sandbox

## 概述

将项目中的 `apps` 目录重命名为 `sandbox`，并更新所有相关的包名、导入路径和构建配置。

## 目录结构变更

### 变更前
```
codepod/
├── apps/
│   ├── agent/
│   ├── runner/
│   ├── server/
│   ├── cli/
│   └── libs/
├── docker/
├── go.work
└── Makefile
```

### 变更后
```
codepod/
├── sandbox/
│   ├── agent/
│   ├── runner/
│   ├── server/
│   ├── cli/
│   └── libs/
├── docker/
├── go.work
└── Makefile
```

## 包名变更

| 原包名 | 新包名 |
|--------|--------|
| `github.com/codepod/codepod/apps/agent` | `github.com/codepod/codepod/sandbox/agent` |
| `github.com/codepod/codepod/apps/runner` | `github.com/codepod/codepod/sandbox/runner` |
| `github.com/codepod/codepod/apps/server` | `github.com/codepod/codepod/sandbox/server` |
| `github.com/codepod/codepod/apps/cli` | `github.com/codepod/codepod/sandbox/cli` |
| `github.com/codepod/codepod/apps/libs/sdk-go` | `github.com/codepod/codepod/sandbox/libs/sdk-go` |

## 需要更新的文件

### 配置文件

1. **go.work**
   - 更新 `replace` 指令中的路径
   - 更新模块路径引用

2. **Makefile**
   - 更新所有构建命令中的路径
   - 更新测试命令中的路径

3. **docker/docker-compose.yml**
   - 更新 `build.context` 路径
   - 更新 `dockerfile` 路径

4. **docker/Dockerfile** (Runner)
   - 更新 `COPY apps/` 为 `COPY sandbox/`

5. **CLAUDE.md**
   - 更新所有文档引用

### Go 源文件

需要更新所有 Go 文件中的 import 语句：

```go
// 变更前
import (
    "github.com/codepod/codepod/apps/agent/pkg/config"
    "github.com/codepod/codepod/apps/runner/internal/runner"
)

// 变更后
import (
    "github.com/codepod/codepod/sandbox/agent/pkg/config"
    "github.com/codepod/codepod/sandbox/runner/internal/runner"
)
```

### TypeScript 源文件

需要更新 server 和 cli 中的导入路径：

```typescript
// 变更前
import { sandboxService } from '../services/sandbox';
import { store } from '../db/store';

// 变更后
import { sandboxService } from '../../services/sandbox';
import { store } from '../../db/store';
```

### 测试文件

更新所有测试文件中的导入路径和模拟路径。

## 关键文件清单

### 配置文件
- [ ] `go.work`
- [ ] `go.work.sum` (重新生成)
- [ ] `Makefile`
- [ ] `docker/docker-compose.yml`
- [ ] `docker/Dockerfile`
- [ ] `CLAUDE.md`

### Agent (Go)
- [ ] `apps/agent/go.mod` → `sandbox/agent/go.mod`
- [ ] 所有 `.go` 文件的 import 语句

### Runner (Go)
- [ ] `apps/runner/go.mod` → `sandbox/runner/go.mod`
- [ ] 所有 `.go` 文件的 import 语句
- [ ] `apps/runner/e2e/` 测试文件

### Server (TypeScript)
- [ ] `apps/server/package.json` (路径引用)
- [ ] 所有 `.ts` 文件的导入路径
- [ ] `apps/server/src/db/repository.ts`
- [ ] `apps/server/src/server.ts`
- [ ] `apps/server/src/services/`

### CLI (TypeScript)
- [ ] `apps/cli/package.json` (路径引用)
- [ ] 所有 `.ts` 文件的导入路径
- [ ] `apps/cli/src/api.ts`
- [ ] `apps/cli/src/commands/`
- [ ] `apps/cli/src/services/`

## 验证步骤

### 1. 构建验证
```bash
make build          # 全部构建
make build-agent    # 构建 agent
make build-runner   # 构建 runner
make build-server   # 构建 server
make build-cli     # 构建 cli
```

### 2. 测试验证
```bash
make test              # 运行所有测试
make test-agent        # Agent 测试
make test-runner       # Runner 测试
make test-server       # Server 测试
make test-cli         # CLI 测试
```

### 3. 运行时验证
```bash
# Docker 部署验证
cd docker && docker-compose up -d
curl http://localhost:8080/health
./dist/index.js create python:3.11
./dist/index.js list
```

## 回滚计划

如果重构出现问题：
1. 使用 `git checkout apps/` 恢复原目录
2. 重新运行 `go work sync` 同步工作区
3. 重新构建所有组件

## 风险评估

| 风险 | 缓解措施 |
|------|----------|
| Import 语句遗漏 | 使用 IDE 重构功能或 sed 批量替换 |
| 配置文件遗漏 | 逐个文件检查确认 |
| 测试失败 | 先运行测试，确保失败时能快速定位 |

## 时间估计

- 目录重命名: 5 分钟
- Import 语句更新: 30-45 分钟
- 配置文件更新: 15 分钟
- 测试验证: 15 分钟
- 修复问题: 30-60 分钟

总计: 约 2-3 小时
