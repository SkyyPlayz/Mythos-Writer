## Mythos Writer ${version}

<!--
  This text is used as the release-notes preamble. The automated changelog
  (commits / merged PRs since the previous tag) is appended below it by the
  release workflow's `generate_release_notes: true` step.

  Before publishing the draft release, replace the "Highlights" bullets with
  the notable user-facing changes for this version.
-->

### Highlights

- _Add notable changes for this release here._

### Downloads

| Platform | File | Notes |
|----------|------|-------|
| Windows (installer) | `Mythos Writer-${version}.exe` | NSIS installer — choose install directory, creates shortcuts |
| Windows (portable) | `Mythos Writer-${version}.zip` | Unzip anywhere and run `Mythos Writer.exe` |
| macOS (disk image) | `Mythos Writer-${version}-arm64.dmg` | Apple Silicon, unsigned build — see install note below |

### Installation

**Windows**
- Installer: run the `.exe` and follow the prompts.
- Portable: extract the `.zip` and launch `Mythos Writer.exe` (no install needed).

**macOS**
- Open the `.dmg` and drag **Mythos Writer** into Applications.
- This build is not yet code-signed/notarized. On first launch, right-click the
  app → **Open** → **Open** to bypass Gatekeeper.

---

### Changelog
