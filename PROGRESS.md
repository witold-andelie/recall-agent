# Recall Agent — 项目进展与待办

> 保存时间：2026-08-12  
> 用途：黑客松中断续作（明天从这里接着干）  
> 项目路径：`D:\AI_Models\hackson\AWS\`

---

## 一句话现状

**本地 agent 已跑通**：CockroachDB Cloud 持久记忆 + hybrid 检索 + 英文 Chat/Memory UI + OpenCode 模型。  
**AWS Bedrock / IAM 尚未配完**；部署与提交物料未做。

---

## 黑客松目标（提醒）

构建以 **CockroachDB 为持久记忆层** 的 agent，部署在 **AWS** 上。

至少使用 **2 项** CockroachDB 工具（我们目标 4 项全覆盖）：

| # | 工具 | 状态 |
|---|------|------|
| ① | 分布式向量索引 | ✅ 已建 `CREATE VECTOR INDEX`，hybrid 用 `<->` |
| ② | 托管 MCP Server | ⬜ 未演示（控制台/Cursor 配置） |
| ③ | ccloud CLI | ⬜ 未演示 |
| ④ | Agent Skills Repo | ⬜ 未演示（开发期可口述） |

至少 **1 项** AWS 服务：

| 服务 | 状态 |
|------|------|
| Amazon Bedrock | ⬜ **未接通**（卡在 IAM / 密钥；Model access 页面已下线属正常） |
| Lambda / S3 / 其他 | ⬜ 未部署 |

产品语言：**纯英文**（UI、prompt、记忆内容）。

---

## 已完成

### 架构与 Schema

| 文件 | 说明 |
|------|------|
| `infra_v3.txt` / `.svg` / `.png` | OPM 框架图（评委叙事 + SQL 面） |
| `schema_v3.sql` | 全量 DDL（表/索引/视图） |
| `recall-agent/sql/schema_v3.sql` | 应用内副本（已应用到集群） |

### CockroachDB Cloud

- 集群已创建（区域含 `aws-eu-central-1`）
- 连接用户：`witold`，库：`defaultdb`
- CRDB 版本实测：约 **v26.2.5**
- Schema 已应用：表、GIN 全文、**VECTOR INDEX**、分析视图
- `feature.vector_index.enabled = true` 已尝试开启
- 探针通过：本地 embedding 可写入并做 L2 检索

### 应用代码 `recall-agent/`

| 模块 | 状态 |
|------|------|
| Next.js 16 + TS + Tailwind | ✅ |
| 匿名 session（cookie） | ✅ |
| `POST /api/chat` NDJSON 流 | ✅ 记忆闭环 |
| Hybrid SQL（向量 + ts_rank + recency + hits） | ✅ |
| 抽取 → SQL 去重 ADD/UPDATE/SKIP | ✅ |
| Memory Panel + `/memory` 浏览器 | ✅ 英文 UI |
| OpenCode Zen Go 聊天 | ✅ `deepseek-v4-flash` |
| 本地 hash embedding | ✅（无远程 embeddings 时） |
| Bedrock 代码路径 | ✅ 已写好，**未用真实 AWS 密钥跑通** |
| `npm run build` | ✅ 曾通过 |
| E2E 两轮记忆 | ✅ cookie 会话下命中偏好/技术栈 |

### 配置（本地）

- 文件：`recall-agent/.env.local`（**已 gitignore，勿提交**）
- 当前 AI：`AI_PROVIDER=openai`，Base：`https://opencode.ai/zen/go/v1`，模型：`deepseek-v4-flash`
- Embedding：`EMBEDDING_PROVIDER=local`
- `DATABASE_URL` 已指向 CRDB Cloud

### 工具脚本

| 脚本 | 用途 |
|------|------|
| `scripts/apply-schema.mjs` | 应用/重跑 schema |
| `scripts/fix-funnel-view.mjs` | 修复 `v_memory_funnel` |
| `scripts/probe-embed.mjs` | 本地向量写库探针 |
| `scripts/e2e-chat.mjs` | 两轮 chat 冒烟 |

### 已知技术点

- **StepFun 已彻底移除**（代码与 env 无残留）
- CRDB：`ln(int)` 不兼容 → hybrid 已改为 `hit_count::float8`
- CRDB：向量索引加速 **L2 `<->`**，不是 cosine
- 新版 Bedrock：**没有 Model access 菜单**；模型默认可用，靠 **IAM + Playground/API**
- 密码/API Key 曾出现在对话中 → **提交前建议轮换** CRDB SQL 密码与各 API Key

---

## 未完成 / 明天接着做

### P0 — 接通 Bedrock（黑客松 AWS 合规）

卡点：**IAM 还没设完**，还没有可用的 `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`。

按顺序：

1. **确认区域**  
   - 控制台右上角：`us-east-1`（推荐，与默认 env 一致）

2. **IAM 在哪**  
   - 顶部搜索 `IAM`，或打开：https://console.aws.amazon.com/iam/  
   - **Users** → 你的用户（或新建 `recall-bedrock`）  
   - **Permissions** → 附加 **`AmazonBedrockFullAccess`**（开发期最快）  
   - **Security credentials** → **Create access key**  
     - 用途选：Application running outside AWS  
     - 保存 Access Key ID + Secret（只显示一次）

3. **Bedrock 控制台验证（无 Model access 页）**  
   - https://console.aws.amazon.com/bedrock  
   - **Playgrounds** → Chat / Text 试 Claude 或 Haiku  
   - Titan Embed V2：Embeddings 相关 playground 或 API 测  
   - Anthropic 可能有**首次使用条款**弹窗，点同意即可

4. **改 `recall-agent/.env.local`**

```env
AI_PROVIDER=bedrock
EMBEDDING_PROVIDER=bedrock
EMBEDDING_DIMS=1024

AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

BEDROCK_CHAT_MODEL=anthropic.claude-3-haiku-20240307-v1:0
# 或控制台 Model catalog 里复制的实际 Model ID
BEDROCK_EMBED_MODEL=amazon.titan-embed-text-v2:0
```

5. **重启 dev 并测**

```powershell
cd D:\AI_Models\hackson\AWS\recall-agent
npm run dev
```

浏览器两轮对话验证记忆；确认不再依赖 OpenCode 也能跑（OpenCode 可留作备用，不删即可）。

### P1 — 演示 CRDB 工具 ②③④

| 工具 | 待做 |
|------|------|
| Managed MCP | 控制台 `cockroachlabs.cloud/mcp` 配进 Cursor/Claude，只读查表 / EXPLAIN |
| ccloud CLI | 安装 → `ccloud auth login` → 集群 list / 状态 JSON 截图 |
| Skills Repo | 开发期用过一次即可，README 写一句 |

### P2 — AWS 部署（可选但加分）

- 前端 S3 / CloudFront，或 API 上 Lambda / 容器  
- 与 Bedrock 同账号叙事更清晰

### P3 — 提交物料

- [ ] 2–3 分钟演示视频（写记忆 → 第二轮命中 → `/memory` 删除）  
- [ ] README 合规对照表 + 架构图  
- [ ] 轮换已暴露的密钥  
- [ ] 确认 `.env*` 未进 git

### P4 — 可选增强（有时间再做）

- Titan 替换 local hash 后，语义检索质量会明显好于现在  
- 微调 dedupe L2 阈值  
- 不要再堆新大功能

---

## 明天启动命令速查

```powershell
cd D:\AI_Models\hackson\AWS\recall-agent

# 确认 .env.local 仍在（DATABASE_URL + 当前 AI 配置）
# 若只跑 OpenCode 备用：
npm run dev
# 浏览器 http://localhost:3000

# Schema 重跑（一般不需要）
# node scripts/apply-schema.mjs

# 两轮记忆冒烟
# node scripts/e2e-chat.mjs
```

演示话术（英文）：

1. `I prefer concise answers. I work in TypeScript on AWS.`  
2. `What do you know about my preferences?`  
3. 看右侧 Memory hits / ADD；再打开 `/memory`

---

## 目录结构（关键）

```
D:\AI_Models\hackson\AWS\
├── PROGRESS.md              ← 本文件
├── infra_v3.*               ← 架构图
├── schema_v3.sql            ← 根目录 schema 副本
└── recall-agent/            ← 主应用
    ├── .env.local           ← 密钥（勿提交）
    ├── .env.example
    ├── sql/schema_v3.sql
    ├── scripts/
    └── src/
        ├── app/             # UI + API routes
        ├── components/
        └── lib/
            ├── ai/          # openai + bedrock
            ├── memory/      # hybrid / extract / dedupe
            ├── db/
            └── session/
```

---

## 风险与注意

1. **密钥曾在对话中出现** → 提交/公开仓库前轮换 CRDB 密码与 API Key。  
2. **OpenCode 额度/可用性** 不保证；Bedrock 接通后以 AWS 为主叙事。  
3. **local embedding** 适合链路演示，评委若深挖语义，优先切 Titan。  
4. 新账号/组织账号可能被 SCP 限制 Bedrock，Playground 失败先查 IAM/计费/区域。

---

## 明天第一件事（checklist）

- [ ] 打开 IAM，建好用户权限 + Access Key  
- [ ] Bedrock Playground 在 us-east-1 跑通一句  
- [ ] 写入 `.env.local` 并 `AI_PROVIDER=bedrock`  
- [ ] `npm run dev` 端到端记忆两轮  
- [ ] （有余力）MCP 或 ccloud 截一张演示图  

**续作时对 AI 说：**「按 `PROGRESS.md` 从 IAM/Bedrock 接着做。」
