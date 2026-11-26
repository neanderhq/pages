"""Validate the public template repository without executing application code."""
import json
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def main():
    for filename in [
        'AGENTS.md', 'README.md', 'LICENSE', 'SECURITY.md', 'mise.toml', 'project.json',
        '.github/pull_request_template.md', '.github/dependabot.yml',
        'docs/development.md', 'docs/testing.md', 'docs/limitations.md',
        '.neander/Dockerfile', '.neander/compose.yaml', '.neander/template.yaml',
        '.github/workflows/check.yml', '.github/workflows/security.yml',
    ]:
        require((ROOT / filename).is_file(), f'Missing {filename}')
    for filename in ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS']:
        require(not (ROOT / filename).exists(), 'Clone policy does not use CODEOWNERS routing')
    project = json.loads((ROOT / 'project.json').read_text())
    package = json.loads((ROOT / 'package.json').read_text())
    require(project['schemaVersion'] == 1 and project['slug'] == 'pages', 'Unknown project identity')
    require(project['name'] == 'Pages' and package['name'] == 'pages', 'Keep the Pages application identity')
    require(project['repositoryVisibility'] == 'public', 'Template source must be public')
    require('MIT License' in (ROOT / 'LICENSE').read_text(), 'Preserve the MIT license')
    require(not (ROOT / 'init').exists() and not (ROOT / '.vscode').exists(), 'Unexpected executable startup/editor automation')
    require((ROOT / 'postcss.config.mjs').read_text().strip() == 'export default { plugins: { "@tailwindcss/postcss": {} } };', 'Review executable PostCSS changes')
    dockerfile = (ROOT / '.neander/Dockerfile').read_text()
    require('RUN --network=none pnpm build' in dockerfile, 'Compile source without outbound network access')
    require('USER node' in dockerfile and 'pnpm install --prod --frozen-lockfile --ignore-scripts' in dockerfile, 'Keep the minimal unprivileged runtime with a fresh production dependency closure')
    require('EMAIL_PROVIDER=' not in dockerfile and 'EMAIL_FROM=' not in dockerfile, 'Do not preset a delivery account')
    scripts = package['scripts']
    require(scripts['dev'] == 'node --env-file-if-exists=.env.local node_modules/vite/bin/vite.js --host 127.0.0.1', 'Keep the audited Vite entrypoint')
    require(scripts['build'] == 'tsc --noEmit && vite build', 'Keep the audited build entrypoint')
    require(scripts['start'] == 'node --env-file-if-exists=.env.local server/start.ts', 'Keep the audited runtime entrypoint')
    require(not any(name in scripts for name in ['preinstall', 'install', 'postinstall', 'prepare']), 'Review lifecycle hooks before introducing execution')
    for name in ['check', 'test', 'build', 'verify', 'test:policy', 'test:production', 'test:template', 'db:seed', 'db:migrate']:
        require(bool(scripts.get(name)), f'Missing {name} command')
    require(scripts['test:production'] == scripts['test:template'], 'Keep the same actual-image smoke entrypoint')
    require('test:policy' in scripts['verify'] and 'build' in scripts['verify'], 'verify must include policy and build')
    workflows = ROOT / '.github/workflows'
    node = re.search(r'^node = "([^"]+)"', (ROOT / 'mise.toml').read_text(), re.M).group(1)
    for filename in workflows.glob('*.yml'):
        raw = filename.read_text()
        data = yaml.load(raw, Loader=yaml.BaseLoader)
        require(data.get('permissions') == {'contents': 'read'}, f'{filename.name}: use read-only permissions')
        require('pull_request_target' not in data.get('on', {}), 'Never execute app code through pull_request_target')
        require('secrets.' not in raw, 'Public app checks cannot require cloud/repository secrets')
        for job in data['jobs'].values():
            require('permissions' not in job and 'environment' not in job, 'No elevated jobs or human environment gates in clone CI')
            for step in job.get('steps', []):
                action = step.get('uses', '')
                if action:
                    require(re.search(r'@[a-f0-9]{40}$', action), f'Pin action by SHA: {action}')
                if action.startswith('actions/checkout@'):
                    require(step.get('with', {}).get('persist-credentials') == 'false', 'Checkout must discard credentials')
                if action.startswith('actions/setup-node@'):
                    require(step['with']['node-version'] == node, 'CI/local Node pins must match')
    checks = yaml.load((workflows / 'check.yml').read_text(), Loader=yaml.BaseLoader)
    require({'policy', 'app', 'production'} <= checks['jobs'].keys(), 'Missing standard check jobs')
    runtime = checks['jobs']['production']
    require(runtime['name'] == 'Runtime security', 'Keep the required runtime security context')
    require(any('test:production' in step.get('run', '') for step in runtime['steps']), 'Run the actual-image smoke suite')
    require(any('test:editor-browser' in step.get('run', '') for step in runtime['steps']), 'Keep the real native editor regression')
    require('schedule' in checks['on'], 'Keep daily runtime scanning')
    bot = yaml.load((ROOT / '.github/dependabot.yml').read_text(), Loader=yaml.BaseLoader)
    require(all('reviewers' not in update for update in bot['updates']), 'Do not add automatic reviewer routing')
    print('Repository contract passed: Pages')


if __name__ == '__main__':
    main()
