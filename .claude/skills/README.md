# Project Agent Skills

`cockroachdb-skills/` is a directory junction to:

`../../vendor/cockroachdb-skills/skills`

That tree is the official [cockroachlabs/cockroachdb-skills](https://github.com/cockroachlabs/cockroachdb-skills) collection (hackathon tool ④).

After `git clone --recurse-submodules` (or `git submodule update --init`):

```powershell
cmd /c mklink /J ".claude\skills\cockroachdb-skills" "vendor\cockroachdb-skills\skills"
```

On macOS/Linux:

```bash
ln -s ../../vendor/cockroachdb-skills/skills .claude/skills/cockroachdb-skills
```
