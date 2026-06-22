# Mythos Writer — Release Runbook

**Owner-gated release process.** Every release to `main` requires owner approval via Ivy. This runbook documents the mechanical steps; approval gates are enforced separately.

---

## Release Flow (High Level)

```
Bump version → Tag commit → Trigger build → Smoke test → Owner sign-off (via Ivy) → Publish
```

1. **Bump version** in `package.json`
2. **Create a git tag** (e.g., `v0.3.0-beta.1`)
3. **GitHub Actions builds** unsigned artifacts (Linux AppImage, macOS DMG, Windows NSIS)
4. **Smoke test** the packaged builds (launch + basic nav)
5. **Get owner sign-off** via Ivy (blocking gate)
6. **GHM publishes** the draft release to public

---

## Step 1 — Bump Version

Determine the next version number using **semver**:

- **Major.Minor.Patch** (e.g., `0.3.0`) for stable releases
- **Major.Minor.Patch-beta.N** (e.g., `0.3.0-beta.1`) for beta releases
- No leading `v` in `package.json`; the git tag adds it

Edit `package.json`:

```bash
npm version 0.3.0-beta.1 --no-git-tag-version
```

Or manually edit the `version` field and commit:

```bash
git add package.json
git commit -m "chore: bump to 0.3.0-beta.1"
```

---

## Step 2 — Create Git Tag

Tag the commit. The tag triggers the GitHub Actions release workflow:

```bash
git tag -a v0.3.0-beta.1 -m "Release v0.3.0-beta.1"
git push origin v0.3.0-beta.1
```

**Important:** Tag on `main` only. Never tag feature branches.

---

## Step 3 — Monitor GitHub Actions Build

The release workflow (`.github/workflows/release.yml`) starts automatically when you push the tag.

Watch the run at: `https://github.com/SkyyPlayz/Mythos-Writer/actions`

The workflow:
1. **Determines release type** — checks if the tag matches `v*-beta` pattern (e.g., beta or stable)
2. **Creates a draft release** on GitHub (initially titled "Release build in progress…")
3. **Builds in parallel**:
   - **Windows** (self-hosted, cross-compiled via Wine + NSIS)
   - **macOS** (macos-latest, unsigned if no Apple cert secrets)
   - **Linux** (self-hosted, AppImage)
4. **Uploads artifacts** to the draft release
5. **Publishes release notes** — generates a changelog from commits since the last tag

**Beta releases** are marked `prerelease: true` on GitHub; stable releases are `prerelease: false`.

### What to Check

- [ ] All three build jobs complete (Linux, macOS, Windows)
- [ ] Artifacts uploaded to the draft release:
  - `Mythos-Writer-x.x.x-beta.1.exe` + `.zip` (Windows)
  - `Mythos-Writer-x.x.x-beta.1.dmg` + `.zip` (macOS)
  - `Mythos-Writer-x.x.x-beta.1.AppImage` (Linux)
  - `.yml` auto-update metadata for each platform
- [ ] Release notes are present (auto-generated changelog)

---

## Step 4 — Smoke Test Unsigned Builds

Download the artifacts from the draft release and smoke-test on each platform:

### Linux (AppImage)

```bash
# Download Mythos-Writer-x.x.x-beta.1.AppImage
chmod +x Mythos-Writer-x.x.x-beta.1.AppImage
./Mythos-Writer-x.x.x-beta.1.AppImage
```

**Test steps:**
1. App launches without error (no crash on startup)
2. Onboarding wizard appears (or settings UI if vault already configured)
3. Open or create a vault
4. Write a few lines in a scene
5. Close the app cleanly

### macOS (DMG, unsigned)

```bash
# Download Mythos-Writer-x.x.x-beta.1.dmg
hdiutil attach Mythos-Writer-x.x.x-beta.1.dmg
# Drag Mythos Writer.app to /Applications (or open from the mount)
open /Applications/Mythos\ Writer.app
```

**Expected:** Gatekeeper may show "App from unidentified developer" warning (normal for unsigned builds). Click **Open**.

**Test steps:** Same as Linux above.

### Windows (NSIS Installer)

```powershell
# Download Mythos-Writer-Setup-x.x.x-beta.1.exe
# Run the installer
.\Mythos-Writer-Setup-x.x.x-beta.1.exe
```

**Test steps:** Same as Linux above.

---

## Step 5 — Owner Sign-Off via Ivy

Once all three platforms pass smoke tests, **post a summary comment on the Paperclip release issue** and **open a `request_confirmation` to Ivy** with:

- **Title:** `Sign-off: publish v0.3.0-beta.1 to GitHub Releases`
- **Body:** Smoke test results (all platforms passed) + link to draft release
- **Continuation:** Wake assignee on accept (`continuationPolicy: wake_assignee_on_accept`)

The **owner must approve** before GHM publishes. This is the blocking gate.

---

## Step 6 — GHM Publishes

After owner sign-off is recorded via Ivy, GHM:

1. Verifies the draft release exists and has all artifacts
2. Publishes the draft release (sets `draft: false`)
3. Pins a summary comment on the release issue with:
   - Download URLs for each platform
   - Release notes (auto-generated or owner-written)
   - Link to the published GitHub release

---

## Troubleshooting

### Build Job Fails

1. Check the job logs in GitHub Actions
2. Common causes:
   - **Node.js version mismatch** (check `nvm use`)
   - **Dependency cache stale** (Actions uses `npm ci` + cache; clear if needed)
   - **Platform-specific issues** (Linux runner offline, macOS hosting minutes exhausted, Wine not installed)
3. Re-tag and push if the fix is on the current branch:
   ```bash
   git tag -d v0.3.0-beta.1
   git push origin :refs/tags/v0.3.0-beta.1
   git tag -a v0.3.0-beta.1 -m "Release v0.3.0-beta.1"
   git push origin v0.3.0-beta.1
   ```

### Draft Release Not Created

- Verify the tag was pushed: `git push origin v0.3.0-beta.1`
- Check GitHub Actions → Release workflow logs
- If Actions didn't trigger, manually trigger via `workflow_dispatch`:
  ```
  GitHub UI: Actions → Release → Run workflow → enter tag (v0.3.0-beta.1) + beta flag
  ```

### Artifacts Missing from Draft

- Wait for all build jobs to complete (may take 10–15 min)
- Check individual job logs for upload errors
- If an upload fails, the job logs will show the `gh release upload` command; re-run manually once the job completes

### Smoke Test Fails

Do **not** proceed to owner sign-off. Fix the root cause on the branch, bump the version to `-beta.2`, and re-tag.

---

## Release Cadence

- **Beta releases** (`-beta.1`, `-beta.2`, etc.) are published as `prerelease: true` on GitHub, visible to users who opt into pre-releases
- **Stable releases** (`v0.3.0`, `v0.4.0`, etc.) are published as `prerelease: false` and appear as "Latest Release"
- Each release corresponds to one commit on `main` (the tag points to a commit)

---

## Auto-Update

The release artifacts include `.yml` metadata files (`latest.yml`, `latest-mac.yml`, `latest-linux.yml`) used by Electron's auto-update feature. These are generated automatically by electron-builder and uploaded alongside the binaries. Users on earlier versions will see an "Update available" prompt and can download the new version in-app.

**Beta releases** use a separate update channel (`publish.channel=beta`) to avoid offering beta builds to stable-release users.

---

## Security Notes

- **Windows certificates** (signing + auto-update trust) are provisioned via GitHub secrets (`WINDOWS_CERTIFICATE_BASE64` + password). If not present, builds are unsigned and the installer shows a security warning.
- **macOS notarization** requires Apple Developer ID secrets. If absent, builds are unsigned and Gatekeeper shows a warning. Notarization is optional for beta releases; signing is enforced for stable releases.
- **Linux AppImage** is not signed (no Linux code-signing standard). Users run at their own discretion; packaging as `.AppImage` allows sandboxing via `--appimage-extract` or `firejail`.

---

## Rollback

If a published release has a critical bug:

1. **Fix the issue** on the branch
2. **Bump to the next patch version** (e.g., `v0.3.0-beta.2` if the prior is `-beta.1`)
3. **Tag and re-release**
4. Do **not** delete the previous tag or re-tag the same version

GitHub will show all releases in the release history; users on auto-update will be offered the new version if it's higher.

---

## Owner-Gated Release Policy

Per [SKY-3109](/SKY/issues/SKY-3109), every release to users requires:

1. **All three required CI checks green** (`ci`, `build-linux`, `build-macos`) on the merge commit
2. **Owner approval via Ivy** before publishing (blocking gate)
3. **GHM performs the mechanical publish** after approval is recorded

This runbook automates the mechanical steps (2–6 above). Step 1 (CI) and the approval gate are separate concerns handled by the merge workflow.
