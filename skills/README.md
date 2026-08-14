# Skills in this repo

## Official (hackathon tool ④) — required

[cockroachlabs/cockroachdb-skills](https://github.com/cockroachlabs/cockroachdb-skills) is vendored as a git submodule:

```
vendor/cockroachdb-skills/
```

Install / refresh:

```bash
git submodule update --init --recursive
# or first time: git clone https://github.com/cockroachlabs/cockroachdb-skills.git vendor/cockroachdb-skills

npx skills add cockroachlabs/cockroachdb-skills
```

Claude / Cursor / any Agent Skills client should discover them under `.claude/skills/cockroachdb-skills/` (Windows junction to the submodule).

These encode CockroachDB onboarding, query/schema design, operations, performance, security, and observability. They are **dev-time / judge-time** capabilities, not part of the Next.js request path.

## Product overlay

`memory-analytics/` documents this app’s four analytics views. It does **not** replace the official repo.
