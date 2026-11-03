"""Use the unmodified native Installer against an in-memory synthetic GitHub ZIP.

Only its HTTP byte transport is replaced. No public repository, token, network,
Git program, or model is used; archive checks, copy and duplicate refusal are native.
"""
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import zipfile

installer = Path(sys.argv[1])
sys.path.insert(0, str(installer.parent))
spec = importlib.util.spec_from_file_location('homer_native_installer_probe', installer)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
archive = io.BytesIO()
with zipfile.ZipFile(archive, 'w') as package:
    package.writestr('fixture-fixed/skills/homer-installed-probe/SKILL.md',
                     '---\nname: homer-installed-probe\ndescription: Run the synthetic installed local skill acceptance script.\n---\n\nUse scripts/probe.py with the bundled Python.\n')
    package.writestr('fixture-fixed/skills/homer-installed-probe/scripts/probe.py',
                     'print("homer-native-installer-verified")\n')

def transport(url):
    assert url == 'https://codeload.github.com/homer-fixture/fixture/zip/fixed'
    return archive.getvalue()

module._request = transport
args = ['--repo', 'homer-fixture/fixture', '--ref', 'fixed', '--path',
        'skills/homer-installed-probe', '--method', 'download']
assert module.main(args) == 0
target = Path(os.environ['CODEX_HOME']) / 'skills/homer-installed-probe'
assert target.joinpath('SKILL.md').exists()
before = target.joinpath('SKILL.md').read_bytes()
assert module.main(args) == 1
assert target.joinpath('SKILL.md').read_bytes() == before
exec(compile(target.joinpath('scripts/probe.py').read_text(), '<synthetic-installed-probe>', 'exec'))
print(json.dumps({'nativeInstallerArchiveAndCopyVerified': True,
                  'duplicateRefusedAndUserContentPreserved': True,
                  'installedScriptExecuted': True, 'network': False}))
