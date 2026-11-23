# PermaNotes

Notes that sync between **Windows, Mac and iPhone**, with your OneNote notebooks imported and every note saveable as a `.pn` file you own.

## Downloads
- **Windows / Mac:** [Releases](https://github.com/stevenmelin/permanotes/releases) → `…-Windows-Setup.exe` or `…-Mac.dmg`
- **iPhone:** open https://stevenmelin.github.io/permanotes/ in Safari → Share → *Add to Home Screen*

Start with the `START HERE - …` file for your device, then `SETUP SYNC.txt`.

## What's here
| Folder | What it is |
|---|---|
| `src/` | The app (shared by desktop and iPhone) |
| `electron/` | Desktop shell (file dialogs, `.pn` double-click, daily backups) |
| `supabase/schema.sql` | Sync database — paste into Supabase once |
| `onenote-exporter/` | One-click tool that exports OneNote from your PC (no Microsoft cloud needed) |
| `mac/`, `windows/`, `installer/` | Double-click build scripts + Inno Setup installer |
| `tools/audit.mjs` | Static wiring audit (`node tools/audit.mjs`, no install needed) |

Every push to `main` builds the Windows installer, the Mac DMG and the iPhone web app on GitHub, and publishes a release.

## .pn files
A `.pn` file is a ZIP container: `permanotes.json` (notes, folders, attachment info) plus `attachments/<id>` (the raw files). One format covers a single note, a folder, or the whole library.
