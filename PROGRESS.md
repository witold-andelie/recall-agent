# Recall Agent — 项目进展与待办

> 保存时间：2026-08-14  
> 用途：黑客松中断续作（从这里接着干）  
> 项目路径：`D:\AI_Models\hackson\AWS\`

---

## 一句话现状

**产品主链路 + AWS 合规项已通**：CockroachDB Cloud 持久记忆 + hybrid 检索 + 英文 Chat/Memory UI + **Amazon Bedrock（Claude Haiku 4.5 + Titan Embed V2）**。  
浏览器已验证两轮对话出现 Memory hits / New writes。  
**还没做**：托管 MCP 控制台点通、ccloud 演示、部署、提交物料。官方 Skills 仓库已强制接入。  
**密钥策略：不轮换。** 只放在本文件夹本地文件里（`.env.local`），gitignore 挡住，不要推 GitHub。

---

## 黑客松目标（提醒）

构建以 **CockroachDB 为持久记忆层** 的 agent，部署在 **AWS** 上。

至少使用 **2 项** CockroachDB 工具（目标 4 项全覆盖）：

| # | 工具 | 状态 |
|---|------|------|
| ① | 分布式向量索引 | ✅ 已建 `CREATE VECTOR INDEX`，hybrid 用 `<->` |
| ② | 托管 MCP Server | ✅ 已改接官方 `https://cockroachlabs.cloud/mcp`（`.mcp.json` / `.grok/config.toml` / `.cursor/mcp.json`）。本机 `grok mcp doctor` 已打到该端点；**还差一次 OAuth 登录** |
| ③ | ccloud CLI | ⬜ 未装、未演示（本机没有 `ccloud`） |
| ④ | Agent Skills Repo | ✅ 官方 `cockroachlabs/cockroachdb-skills` 已 submodule 到 `vendor/cockroachdb-skills`，`AGENTS.md` 强制先读；产品 overlay 仍是 `skills/memory-analytics/` |

至少 **1 项** AWS 服务：

| 服务 | 状态 |
|------|------|
| Amazon Bedrock | ✅ **已接通**（IAM 用户 + 真实 API + 浏览器记忆闭环） |
| Lambda / S3 / 其他 | ⬜ 未部署（可选加分） |

产品语言：UI 默认英文；**回复跟本轮用户语言**（同一对话可切换）。记忆按用户陈述语言落库。

---

## 已完成

### 架构与 Schema

| 文件 | 说明 |
|------|------|
| `README.md` | 架构说明（GitHub 叙事；本地仍保留 `infra_v3.*` 图，不入库） |
| `schema_v3.sql` | 全量 DDL（表/索引/视图） |
| `recall-agent/sql/schema_v3.sql` | 应用内副本（已应用到集群） |

### CockroachDB Cloud

- 集群已创建（区域含 `aws-eu-central-1`）
- 连接用户：`witold`，库：`defaultdb`
- CRDB 版本实测：约 **v26.2.5**
- Schema 已应用：表、GIN 全文、**VECTOR INDEX**、分析视图
- `feature.vector_index.enabled = true` 已尝试开启
- 探针通过：embedding 可写入并做 L2 检索

### 应用代码 `recall-agent/`

| 模块 | 状态 |
|------|------|
| Next.js 16 + TS + Tailwind | ✅ |
| 匿名 session（cookie） | ✅ |
| `POST /api/chat` NDJSON 流 | ✅ 记忆闭环 |
| Hybrid SQL（向量 + ts_rank + recency + hits） | ✅ |
| 抽取 → SQL 去重 ADD/UPDATE/SKIP | ✅ |
| Memory Panel + `/memory` 浏览器 | ✅ 英文 UI |
| OpenCode Zen Go 聊天 | ✅ 备用，`deepseek-v4-flash`（现已不走这条） |
| 本地 hash embedding | ✅ 备用（现已不走这条） |
| Bedrock 代码路径 | ✅ **真实密钥跑通** |
| `npm run build` | ✅ 曾通过 |
| E2E / 浏览器两轮记忆 | ✅ Bedrock 下 Memory hits / New writes 已出现 |

### AWS / Bedrock（2026-08-14 完成）

- 用 **Root** 登录；Root 无 MFA（安全提醒，不挡路）
- 已建 IAM 用户 **`recall-bedrock`**（不要给控制台登录；不要在 Root 上建 Access Key）
- 权限：`AmazonBedrockFullAccess`
- 用途：Application running outside AWS
- Access Key 已写入 `recall-agent/.env.local`（gitignore，**勿提交**）
- 区域：`us-east-1`
- 账号套餐：**Paid account plan**（新版「付费账户计划」）
  - **不能降回 Free plan**（官方 FAQ Q10）
  - 不是月租；看不到「扣款计划」是正常的
  - 用多少付多少；抵扣金仍会先抵 Bedrock 费用
  - 黑客松建议 **先别关户**；关户 90 天后永久删除，Bedrock 叙事会断

### 实测可用 / 不可用的模型（us-east-1）

脚本：`recall-agent/scripts/probe-bedrock.mjs`

| 用途 | Model ID | 结果 |
|------|----------|------|
| Chat（当前默认） | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | ✅ 用 inference profile |
| Chat 备选 | `amazon.nova-lite-v1:0` / `nova-micro` / `nova-pro` | ✅ |
| Embed（当前默认） | `amazon.titan-embed-text-v2:0` | ✅ 1024 维，对齐 schema |
| 旧 Claude 3 Haiku | `anthropic.claude-3-haiku-20240307-v1:0` | ❌ Legacy / 30 天未用 |
| 旧 Claude 3.5 Sonnet | `anthropic.claude-3-5-sonnet-20240620-v1:0` | ❌ EOL |
| 旧 on-demand Claude | 无 `us.` 前缀的新 ID | ❌ 需要 inference profile |

代码默认已改：`src/lib/ai/chat.ts`、`.env.example` 指向 Haiku 4.5 profile。这两处 + `probe-bedrock.mjs` 还在工作区未提交。

### 配置（本地）

- 文件：根目录 `.env.local` + `recall-agent/.env.local`（内容相同；**gitignore，勿提交，不轮换**）
- 当前 AI：`AI_PROVIDER=bedrock`
- Chat：`BEDROCK_CHAT_MODEL=us.anthropic.claude-haiku-4-5-20251001-v1:0`
- Embed：`EMBEDDING_PROVIDER=bedrock` / Titan V2 / `EMBEDDING_DIMS=1024`
- OpenCode 配置仍留在 `.env.local` 作备用，不删
- `DATABASE_URL` 已指向 CRDB Cloud

### 工具脚本

| 脚本 | 用途 |
|------|------|
| `scripts/apply-schema.mjs` | 应用/重跑 schema |
| `scripts/fix-funnel-view.mjs` | 修复 `v_memory_funnel` |
| `scripts/probe-embed.mjs` | 本地向量写库探针 |
| `scripts/probe-bedrock.mjs` | 探测 Bedrock chat / embed 哪些 model ID 可用 |
| `scripts/e2e-chat.mjs` | 两轮 chat 冒烟 |

### 已知技术点

- **StepFun 已彻底移除**（代码与 env 无残留）
- CRDB：`ln(int)` 不兼容 → hybrid 已改为 `hit_count::float8`
- CRDB：向量索引加速 **L2 `<->`**，不是 cosine。hybrid / dedupe 的 ANN 已改成只按 `user_id` + `<->`（索引 hint），`EXPLAIN` 会出现 `vector search`；`deleted_at` / `kind` 在过取后过滤
- 新版 Bedrock：**没有 Model access 菜单**；模型默认可用，靠 **IAM + Playground/API**
- 新账号上旧 Claude 3.x 常 EOL；优先 inference profile（`us.anthropic...`）或 Nova
- 密钥 **不轮换**，只放本机：`D:\AI_Models\hackson\AWS\.env.local` 与 `recall-agent/.env.local`（后者给 Next.js 读）

---

## 未完成 / 接着做

### P0 — 接通 Bedrock

✅ 已完成。不必再走 IAM 建用户流程，除非轮换密钥。

### P1 — 演示 CRDB 工具 ②③④（下一步优先）

规则至少 2 项，现在只有 ①。再做 1 项即可达标；③ 最快。

| 工具 | 待做 |
|------|------|
| ③ ccloud CLI | 本机未装。安装 → `ccloud auth login` → `ccloud cluster list` / `get` 留 JSON 截图 |
| ② Managed MCP | 角色 SQL 已写好。控制台建 `recall_analyst` 密码，把 MCP 指过去，跑 `SELECT * FROM v_memory_funnel` |
| ④ Skills Repo | 官方仓库已强制接入（submodule + `AGENTS.md`） |

### P2 — AWS 部署（可选但加分）

- 前端 S3 / CloudFront，或 API 上 Lambda / 容器
- 与 Bedrock 同账号叙事更清晰
- **有余力再做**；先不要为了「取消付费计划」去关户

### P3 — 提交物料

- [ ] 2–3 分钟演示视频（写记忆 → 第二轮命中 → `/memory` 删除）
- [x] README 合规对照表（①②③④ + Bedrock）
- [x] 密钥不轮换，只留在本文件夹 `.env.local`（根目录 + `recall-agent/`）
- [ ] 提交前再确认一次：`git status` 里没有 `.env.local`
- [ ] 提交未入库改动：`.env.example`、`chat.ts` 默认模型、`scripts/probe-bedrock.mjs`、根目录 `.gitignore`

### P4 — 可选增强（有时间再做）

- Titan 已替换 local hash（语义检索已比之前好）
- 微调 dedupe L2 阈值
- 不要再堆新大功能

---

## AWS 账号备忘（别再踩坑）

- 当前是 **Paid account plan**，**不能改回 Free**
- 不是包月；账单页没有「扣款计划」= 正常
- 查看用量 / 抵扣金：
  - https://console.aws.amazon.com/billing/home
  - https://console.aws.amazon.com/billing/home#/credits
  - https://console.aws.amazon.com/billing/home#/freetier
- 建议建 **$1 Budgets 告警**，避免意外扣卡
- **不要关户**（除非确定放弃这个号和 Bedrock 演示）
- 若坚持关户：必须 Root → 右上角账号名 → Account → Close account → 输入 12 位 Account ID
  - 90 天内可找 Support 重开；关户邮箱不能直接拿去注册新号
  - 关完后把 `.env.local` 改回 `AI_PROVIDER=openai` + `EMBEDDING_PROVIDER=local`

关户文档：https://docs.aws.amazon.com/accounts/latest/reference/manage-acct-closing.html

---

## 启动命令速查

```powershell
cd D:\AI_Models\hackson\AWS\recall-agent

# 当前默认走 Bedrock（.env.local 已配）
npm run dev
# 浏览器 http://localhost:3000

# 探测哪些 Bedrock 模型还能用
# node scripts/probe-bedrock.mjs

# Schema 重跑（一般不需要）
# node scripts/apply-schema.mjs

# 两轮记忆冒烟（需 dev 已启动）
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
├── AGENTS.md / CLAUDE.md    ← 强制：CRDB 工作先读官方 skills
├── vendor/cockroachdb-skills ← 官方 Agent Skills 子模块（④）
├── PROGRESS.md              ← 本文件
├── README.md                ← 架构说明 + 评委对照表
├── .env.local               ← 本地密钥副本（gitignore，不上 GitHub）
├── .mcp.json                ← 只读 analytics MCP
├── mcp_readonly_role.sql    ← recall_analyst 只授权 v_*
├── skills/memory-analytics/ ← ④ Agent Skill
├── infra_v3.*               ← 本地架构图（gitignore，不上 GitHub）
├── schema_v3.sql            ← 根目录 schema 副本
└── recall-agent/            ← 主应用
    ├── .env.local           ← 运行时密钥（Next.js 读这个；勿提交）
    ├── .env.example
    ├── sql/schema_v3.sql
    ├── scripts/
    │   └── probe-bedrock.mjs
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

1. **密钥不轮换**，只放本文件夹 `.env.local`。根目录与 `recall-agent/.gitignore` 都忽略它，**不要 `git add` 任何 `.env.local`**。
2. OpenCode 仅备用；对外叙事以 **Bedrock + CRDB** 为主。
3. Paid plan 不会自动扣月租，但 Bedrock 按量计费；设 $1 告警。
4. 关户会丢掉 IAM / Bedrock / 剩余抵扣金，黑客松期间不要关。
5. 难爬网站用本机已装的 **Scrapling**（https://github.com/D4Vinci/Scrapling），不要另起一套爬虫。

---

## 下一步第一件事（checklist）

- [ ] 安装 `ccloud`，`auth login`，集群 `list` / `get` 留一张 JSON 截图
- [ ] 给 `recall_analyst` 设密码，Cloud MCP 连上后跑 `v_memory_funnel`
- [ ] 有余力再拍 2–3 分钟演示视频

**续作时对 AI 说：**「按 `PROGRESS.md` 从 P1 ccloud / MCP 接着做。」
