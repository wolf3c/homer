"""Inventory bundled Python distributions and preserve their upstream license material."""
import hashlib
import importlib.metadata
import json
import shutil
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
notices = root / 'notices' / 'python-packages'
notices.mkdir(parents=True, exist_ok=True)
components = []
requirements = []
for dist in sorted(importlib.metadata.distributions(), key=lambda d: d.metadata['Name'].lower()):
    name, version = dist.metadata['Name'], dist.version
    files = []
    for entry in dist.files or []:
        source = Path(dist.locate_file(entry))
        if source.is_file() and any(word in source.name.lower() for word in ['license', 'licence', 'copying', 'notice', 'copyright']):
            target = notices / name / str(entry).replace('../', '')
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            files.append(str(target.relative_to(root)))
    license_text = dist.metadata.get('License-Expression') or dist.metadata.get('License') or ''
    classifiers = [v for v in dist.metadata.get_all('Classifier', []) if v.startswith('License ::')]
    components.append({'name': name, 'version': version, 'type': 'library',
                       'purl': f'pkg:pypi/{name.lower()}@{version}',
                       'licenseDeclaration': license_text, 'licenseClassifiers': classifiers,
                       'noticeFiles': files, 'requires': dist.requires or []})
    if name.lower() not in ['pip', 'setuptools']:
        requirements.append(f'{name}=={version}')
(root / 'python-components.json').write_text(json.dumps(components, indent=2) + '\n')
print(json.dumps({'packages': len(components), 'withoutLicenseFiles': [c['name'] for c in components if not c['noticeFiles']], 'requirements': requirements}))
