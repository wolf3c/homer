# Homer local capability resources

These resources supplement fixed Codex CLI 0.163.0. The native Shell, files,
web search, image generation, Skill Creator/Installer and native Skill/MCP/Plugin
management remain owned by Codex and Homer. No Anthropic Office skills, Cindy
runtime, user account, credential, browser profile or private configuration is included.

Upstream notices remain intact within the immutable release. Individual projects
retain their copyright and license; this resource bundle does not relicense them.

| Component | License material included | Upstream source |
| --- | --- | --- |
| Node 22.22.0 and its bundled dependencies | `node/LICENSE`; bundled npm package licenses | https://github.com/nodejs/node/tree/v22.22.0 |
| CPython 3.12.12 | `python/lib/python3.12/LICENSE.txt`, `notices/python-runtime/licenses/` | https://github.com/python/cpython/tree/v3.12.12 |
| Python standalone build dependencies | Exact full-distribution `notices/python-runtime/PYTHON.json`, license files; source archive hash in `runtime-lock.json` | https://github.com/astral-sh/python-build-standalone/tree/20251014 |
| Playwright and playwright-core | `node_modules/*/LICENSE`, `NOTICE`, `ThirdPartyNotices.txt` | https://github.com/microsoft/playwright/tree/v1.64.1 |
| Open-source Chromium snapshot | `Chromium-THIRD-PARTY-NOTICES.html` exported from this exact binary's `chrome://credits`, including component license text and source links | https://chromium.googlesource.com/chromium/src/ |
| cliclick 5.1 | `desktop/LICENSE` (BSD-3-Clause); only the macOS code signature is added | https://github.com/BlueM/cliclick/tree/5.1 |
| Python office libraries and transitive wheels | Exact hashes and upstream declarations in `python-wheels.lock.json`; complete available upstream license files in `notices/python-packages/` | Individual PyPI projects pinned in the lock |

Python wheel declarations: python-docx, python-pptx, openpyxl, PyYAML,
et_xmlfile and charset-normalizer use MIT; pypdf and lxml use BSD-3-Clause;
XlsxWriter uses BSD-2-Clause; typing_extensions uses PSF-2.0; Pillow uses MIT-CMU
and carries notices for its compiled dependencies; ReportLab carries its BSD
license and font notices. The full wheel material is retained rather than replaced
by these short labels. Python runtime extensions report their linked libraries and
licenses in PYTHON.json; platform system libraries are not redistributed here.

The Node executable's own dependency notices, npm's dependency licenses, pip's
vendored license files, Pillow/lxml notices and Chromium's component notices are
retained. `SBOM.json`, the fixed source locks and per-file `resource-manifest.json`
serve different purposes: composition, build provenance and integrity. A hash alone
does not establish license permission or authorize a new account or operation.

Browser use has no Browser Use cloud service dependency. This distribution excludes
Chrome for Testing and standalone FFmpeg downloads. Chromium may itself contain
media components; their upstream notices and source links remain included in its
credits. Corresponding upstream source remains available through the included
component links; no binary libraries were patched. The Chromium revision/version
is recorded in runtime-lock.json and is not automatically updated from LAST_CHANGE.

No third-party service entitlement is included. Web search and image generation
need a supported native connection/model and may consume service quotas. Desktop
actions need本人 Accessibility and Screen Recording grants for the actual launcher.
The macOS local executable signature used for acceptance is ad hoc; a public
notarized application release needs its own distribution signing process.
