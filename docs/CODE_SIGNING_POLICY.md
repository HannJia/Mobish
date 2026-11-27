# Code Signing Policy / 代码签名政策

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

> [!NOTE]
> **Status:** SignPath Foundation onboarding is in progress for **墨笔生花 (mobish)**. Releases up to `1.1.8` are unsigned; Windows installers will be signed through SignPath Foundation starting from the first release published after approval.

---

## 1. Scope / 签名范围

- **Covered artifacts:** Official Windows x64 release binaries and NSIS installers (`mobish-<version>.exe` and packaged `mobish.exe`) built from tagged releases in the public repository [HannJia/Mobish](https://github.com/HannJia/Mobish).
- **Not covered:** Local developer builds, pull-request preview builds, third-party dependencies not built from this repository, and source archives.
- **Verified publisher display:** Because the certificate is issued to the SignPath Foundation, Windows SmartScreen and file properties will display **SignPath Foundation** as the signer/publisher while the product metadata remains **墨笔生花 (`mobish`)**.

## 2. Build Provenance / 构建来源与可追溯性

- Official release installers submitted for code signing are built exclusively on **GitHub-hosted runners** (`windows-latest`) via the public GitHub Actions workflow [`.github/workflows/build-windows.yml`](../.github/workflows/build-windows.yml) from public commits/tags in `HannJia/Mobish`.
- Local builds created on a developer workstation are never submitted to SignPath.
- Before signing, the build runs TypeScript type checking (`npm run typecheck`), deterministic OCR asset verification (`npm run prepare:ocr`), Electron packaging, and `scripts/audit-release.cjs` (checking `app.asar` integrity, excluding private/credential files, and verifying release checksums).

## 3. Team Roles & Governance / 团队角色与审核机制

**墨笔生花 (mobish)** is currently maintained by a solo maintainer. In accordance with SignPath Foundation security requirements:

- **Authors / Committers:** `HannJia` (GitHub: [@HannJia](https://github.com/HannJia))
- **Reviewers:** `HannJia` (self-review of all commits, workflow edits, and release diffs; reviews external pull requests if submitted)
- **Approvers:** `HannJia` (manually verifies and approves every production signing request in SignPath)

Security controls:
- Multi-Factor Authentication (MFA / 2FA) is enforced on the maintainer's GitHub account and SignPath account.
- Signing credentials (`SIGNPATH_API_TOKEN`, `SIGNPATH_ORGANIZATION_ID`) are stored only in GitHub Actions Secrets, never committed to source control, and never accessible to pull requests from forks.

## 4. Privacy & Data Handling / 隐私与数据说明

**墨笔生花 (mobish)** is a local-first desktop application under the [MIT License](../LICENSE):
- **No built-in telemetry or user tracking:** The application does not collect analytics, usage statistics, or crash telemetry, and does not send manuscripts to the project author.
- **Local storage:** Novels, outlines, knowledge bases, and writing history are stored locally on the user's device. API keys are encrypted via the operating system's secure storage (`safeStorage`).
- **User-configured external calls:** Network requests are sent only to AI model providers, web search services, or embedding services explicitly configured by the user, or to public GitHub Releases when checking for software updates (which can be disabled in settings).

For full details, see the [Data, Privacy & Costs section of README.md](../README.md#数据隐私与费用) and [mobish.cn](https://mobish.cn).

## 5. Contact / 联系方式

- Repository & Issues: https://github.com/HannJia/Mobish/issues
- Website: https://mobish.cn
- Maintainer Email: `1183617133@qq.com`
