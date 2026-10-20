import path from 'node:path';
import { exists, readText } from './fs.js';

export interface ProjectDetection {
  stack: 'node' | 'maven' | 'gradle' | 'python' | 'go' | 'rust' | 'unknown';
  packageManager: 'npm' | 'pnpm' | 'yarn' | null;
  checks: string[];
  setup: string[];
  languageVersion?: string;
}

export async function detectProject(root: string): Promise<ProjectDetection> {
  if (await exists(path.join(root, 'package.json'))) {
    return detectNode(root);
  }
  if (await exists(path.join(root, 'pom.xml'))) {
    return {
      stack: 'maven',
      packageManager: null,
      checks: ['mvn -B -ntp test'],
      setup: [],
    };
  }
  if (
    (await exists(path.join(root, 'build.gradle'))) ||
    (await exists(path.join(root, 'build.gradle.kts')))
  ) {
    const wrapper = await exists(path.join(root, 'gradlew'));
    return {
      stack: 'gradle',
      packageManager: null,
      checks: [wrapper ? './gradlew test' : 'gradle test'],
      setup: [],
    };
  }
  if (
    (await exists(path.join(root, 'pyproject.toml'))) ||
    (await exists(path.join(root, 'requirements.txt')))
  ) {
    return {
      stack: 'python',
      packageManager: null,
      checks: ['pytest -q'],
      setup: (await exists(path.join(root, 'requirements.txt')))
        ? ['python -m pip install -r requirements.txt']
        : [],
    };
  }
  if (await exists(path.join(root, 'go.mod'))) {
    return { stack: 'go', packageManager: null, checks: ['go test ./...'], setup: [] };
  }
  if (await exists(path.join(root, 'Cargo.toml'))) {
    return { stack: 'rust', packageManager: null, checks: ['cargo test'], setup: [] };
  }
  return { stack: 'unknown', packageManager: null, checks: [], setup: [] };
}

async function detectNode(root: string): Promise<ProjectDetection> {
  let scripts: Record<string, string> = {};
  try {
    const parsed = JSON.parse(await readText(path.join(root, 'package.json'))) as {
      scripts?: Record<string, string>;
    };
    scripts = parsed.scripts ?? {};
  } catch {
    // Keep empty scripts; the generated CI will fail loudly rather than pretend.
  }

  const packageManager = (await exists(path.join(root, 'pnpm-lock.yaml')))
    ? 'pnpm'
    : (await exists(path.join(root, 'yarn.lock')))
      ? 'yarn'
      : 'npm';

  const checks: string[] = [];
  if (scripts.test) checks.push(packageManager === 'npm' ? 'npm test' : `${packageManager} test`);
  if (scripts.build) checks.push(packageManager === 'npm' ? 'npm run build' : `${packageManager} build`);
  if (scripts.lint) checks.push(packageManager === 'npm' ? 'npm run lint' : `${packageManager} lint`);

  const setup: string[] = [];
  if (packageManager === 'npm') {
    setup.push(
      (await exists(path.join(root, 'package-lock.json'))) ? 'npm ci' : 'npm install',
    );
  } else if (packageManager === 'pnpm') {
    setup.push('corepack enable', 'pnpm install --frozen-lockfile');
  } else {
    setup.push('corepack enable', 'yarn install --immutable');
  }

  return { stack: 'node', packageManager, checks, setup };
}

export function renderCiWorkflow(detection: ProjectDetection, baseBranch: string): string {
  const header = [
    'name: CI',
    '',
    'on:',
    '  pull_request:',
    '  push:',
    `    branches: [${baseBranch}]`,
    '',
    'permissions:',
    '  contents: read',
    '',
    'jobs:',
    '  test:',
    '    name: Build and test',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
  ];

  const lines = [...header];

  if (detection.stack === 'node') {
    lines.push(
      '      - uses: actions/setup-node@v4',
      '        with:',
      '          node-version: 20',
      detection.packageManager === 'npm' ? '          cache: npm' : '',
      ...detection.setup.map((command) => `      - run: ${quote(command)}`),
      ...detection.checks.map((command) => `      - run: ${quote(command)}`),
    );
  } else if (detection.stack === 'maven') {
    lines.push(
      '      - uses: actions/setup-java@v4',
      '        with:',
      '          distribution: temurin',
      '          java-version: "17"',
      '          cache: maven',
      `      - run: ${quote('mvn -B -ntp test')}`,
    );
  } else if (detection.stack === 'gradle') {
    lines.push(
      '      - uses: actions/setup-java@v4',
      '        with:',
      '          distribution: temurin',
      '          java-version: "17"',
      `      - run: ${quote(detection.checks[0] ?? './gradlew test')}`,
    );
  } else if (detection.stack === 'python') {
    lines.push(
      '      - uses: actions/setup-python@v5',
      '        with:',
      '          python-version: "3.12"',
      ...detection.setup.map((command) => `      - run: ${quote(command)}`),
      `      - run: ${quote('pytest -q')}`,
    );
  } else if (detection.stack === 'go') {
    lines.push(
      '      - uses: actions/setup-go@v5',
      '        with:',
      '          go-version: "stable"',
      `      - run: ${quote('go test ./...')}`,
    );
  } else if (detection.stack === 'rust') {
    lines.push(
      '      - run: rustup component add clippy',
      `      - run: ${quote('cargo test')}`,
    );
  } else {
    lines.push(
      '      - name: No checks configured',
      '        run: |',
      '          echo "No build or test command was detected."',
      '          echo "Configure .handrail/config.json checks.commands and update this workflow."',
      '          exit 1',
    );
  }

  return `${lines.filter((line) => line !== '').join('\n')}\n`;
}

function quote(command: string): string {
  return JSON.stringify(command);
}
