# Auto-Update Testing Guide (v0.3.0-beta.1 → N+1)

This guide documents how to test the auto-update flow on both Linux (E2E) and macOS (manual).

---

## Part I: Linux E2E Testing (Automated)

### Prerequisites

- Two builds published as GitHub pre-releases:
  - **v0.3.0-beta.1** (current, already released)
  - **v0.3.1-beta.1** (new release, for testing)
- Both builds signed (Windows) or unsigned (Linux/macOS) per release strategy
- Build artifacts in GitHub releases with proper `latest.yml` / release notes

### Setup

```bash
# Enable auto-update and build the release version
MYTHOS_AUTO_UPDATE=1 npm run build:electron
npm run dist:linux  # Creates AppImage for Linux

# Verify the built app reports version 0.3.0-beta.1
./out/Mythos\ Writer-0.3.0-beta.1.AppImage --version
```

### Run E2E Test

```bash
# With MYTHOS_AUTO_UPDATE enabled, run the auto-update test
MYTHOS_AUTO_UPDATE=1 npx playwright test e2e/auto-update-beta.spec.ts --reporter=list
```

### Expected Flow

1. **Detect available update**
   - App starts with `updateChannel: 'beta'` in settings
   - IPC handler `app:checkForUpdate` queries GitHub pre-releases
   - Response: `{ available: true, version: '0.3.1-beta.1', releaseNotes: '...' }`

2. **Auto-download**
   - `autoDownload: true` in electron-updater config
   - App downloads v0.3.1-beta.1 delta/full binary in background
   - Event: `update-available` → `download-progress` → `update-downloaded`

3. **Schedule install**
   - Call `app:installUpdate` → returns `{ scheduled: true }`
   - `autoInstallOnAppQuit: true` means install triggers on next app quit
   - Update state in UI: "Update ready. Restart to apply."

4. **Verify new version after restart**
   - User quits app (or test calls `quitAndInstall()`)
   - Installer runs: extracts, replaces binaries, restarts app
   - New app reports version 0.3.1-beta.1 via `app.getVersion()`

### Test Coverage

✓ Channel selection: stable → 'latest', beta → 'beta'  
✓ Update detection: `app:checkForUpdate` returns correct shape  
✓ Auto-download: files are fetched (spy on progress events)  
✓ Install scheduling: `app:installUpdate` returns scheduled=true  
✓ Post-restart verification: app reports new version  

---

## Part II: macOS Manual Testing

### Why Manual?

macOS code-signing and notarization are platform-specific and require:
- Apple Developer account + signing certificate
- Machine with macOS running (for signing)
- Network access for notarization checks

E2E automation for this would require CI/CD integration; manual testing is practical for beta.

### Prerequisites

- Two builds released on GitHub:
  - **v0.3.0-beta.1** (current DMG, signed & notarized)
  - **v0.3.1-beta.1** (new DMG, signed & notarized)
- Both with matching `latest-mac.yml` describing versions & release notes
- Both published as GitHub pre-releases (tagged as `beta`)

### Setup Steps

1. **Install v0.3.0-beta.1 on clean macOS**
   ```bash
   # Download from GitHub releases
   # Open DMG → drag app to Applications
   # Or: curl -Lo ~/Downloads/Mythos-Writer-0.3.0-beta.1.dmg \
   #     https://github.com/SkyyPlayz/Mythos-Writer/releases/download/v0.3.0-beta.1/Mythos-Writer-0.3.0-beta.1.dmg
   # Verify version: /Applications/Mythos\ Writer.app/Contents/Info.plist → CFBundleVersion
   ```

2. **Launch app and verify beta channel is enabled**
   ```
   Settings → Auto-Update → Channel: "beta"
   ```

3. **Trigger update check**
   ```
   Menu Bar (Mythos Writer) → Check for Updates
   OR
   Settings → Auto-Update → [Manual check button if present]
   ```

### Expected Behavior

#### Scenario: Update Available

1. **Notification appears**
   - Dialog or banner: "Update available: v0.3.1-beta.1"
   - Displays release notes from GitHub

2. **Download & Install**
   - User clicks "Update" or "Install"
   - App downloads v0.3.1-beta.1 (~150-300 MB depending on delta/full)
   - Progress bar or background indicator shows download status
   - "Ready to restart" message appears once download completes

3. **Restart App**
   - User clicks "Restart now" or waits for auto-restart timer
   - App closes gracefully, installer applies update
   - App relaunches with v0.3.1-beta.1
   - Verify in About → Version shows v0.3.1-beta.1

#### Scenario: Already Up-to-Date

- Dialog: "You're on the latest version"
- No download triggered

### Manual Test Evidence Checklist

Document these screenshots/notes for sign-off:

- [ ] **Start state**: Settings panel showing `updateChannel: beta` and version 0.3.0-beta.1
- [ ] **Check available**: Update available dialog showing v0.3.1-beta.1 + release notes
- [ ] **Download progress**: Download indicator (if visible) or system log showing data transfer
- [ ] **Ready to install**: "Restart to apply" prompt appears
- [ ] **Post-restart**: App reopens showing version 0.3.1-beta.1 in About panel
- [ ] **Vault integrity**: Sample vault (or user's vault) loads and data is intact post-update

### Logging & Debugging

If update fails, check logs for diagnostics:

```bash
# macOS electron-updater logs (usually in ~/Library/Logs/ or ~/Library/Caches/)
# Or launch app with debug env:
DEBUG=electron-updater* open /Applications/Mythos\ Writer.app

# Check network access (GitHub API):
curl -I https://api.github.com/repos/SkyyPlayz/Mythos-Writer/releases

# Verify signing/notarization:
codesign -v /Applications/Mythos\ Writer.app
spctl -a -v /Applications/Mythos\ Writer.app
```

---

## Part III: Configuration Reference

### Environment Variables

| Variable | Value | Effect |
| -------- | ----- | ------ |
| `MYTHOS_AUTO_UPDATE` | `1` | Enable auto-update feature (required for tests) |
| `DEBUG` | `electron-updater*` | Enable verbose logging from electron-updater |

### Settings (`settings.json`)

```json
{
  "updateChannel": "beta",
  "apiKey": "",
  "onboardingComplete": true,
  ...
}
```

- `updateChannel: "beta"` → Check GitHub pre-releases
- `updateChannel: "stable"` → Check stable GitHub releases only

### IPC Channels

- `app:checkForUpdate` → async check, returns `{ available, version, releaseNotes }`
- `app:installUpdate` → schedule install on app quit
- `UPDATE_GET_INFO` → fetch last known update info
- `UPDATE_CHECK` → async check (legacy, prefer `app:checkForUpdate`)

---

## Part IV: Known Issues & Workarounds

### GitHub API Rate Limiting

- GitHub limits unauthenticated API calls to 60/hour per IP
- Workaround: Use GitHub token in release config
  ```js
  // electron-builder.config.js or main.ts
  autoUpdater.allowPrerelease = true;
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'SkyyPlayz',
    repo: 'Mythos-Writer',
    token: process.env.GITHUB_TOKEN,  // ← use PAT if available
  });
  ```

### Network Timeouts

- Slow connections may timeout during download (usually 30s default)
- Logs will show `RequestError: ETIMEOUT`
- Workaround: Test on stable network or increase timeout in electron-updater config

### Private Repository Updates

- If releases are in a private repo, set `GITHUB_TOKEN` with appropriate scopes
- Or use an update server (e.g., GitHub Releases API token + custom server)

---

## Part V: Sign-Off & Documentation

Once manual testing is complete, document:

1. **Date tested**: YYYY-MM-DD
2. **Platform**: macOS 12+, Intel/Apple Silicon
3. **Version pair**: v0.3.0-beta.1 → v0.3.1-beta.1
4. **Evidence**:
   - Screenshots (settings, update dialog, restart sequence, final version)
   - Logs (electron-updater output if issues occurred)
   - Vault integrity check (sample save/load post-update)
5. **Status**: ✓ Pass / ✗ Fail + details

---

## Testing Checklist (Definition of Excellent)

**Linux E2E**:
- [ ] Test runs without manual intervention
- [ ] All assertions pass (detect, download, schedule, verify version)
- [ ] No flaky timing issues (use explicit waits, not sleep)
- [ ] Logs are clear and actionable

**macOS Manual**:
- [ ] Screenshots document each step (6-8 total)
- [ ] Settings show correct channel selection
- [ ] Release notes display properly
- [ ] Vault data survives update (no data loss)
- [ ] Post-update app works normally (no crashes, UI responsive)

---

## References

- [Electron-updater docs](https://www.electron.build/auto-update)
- [GitHub releases API](https://docs.github.com/rest/releases)
- [Electron auto-update patterns](https://www.electronjs.org/docs/tutorial/updates)
- [Code signing on macOS](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/)
