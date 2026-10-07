import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

describe('[F-1] monorepo layout', () => {
  it('has the web app, API, capture worker and Python render worker', () => {
    const root = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(root.workspaces).toEqual(expect.arrayContaining(['packages/*', 'apps/*', 'workers/capture']));
    for (const p of ['apps/web/package.json', 'apps/api/package.json', 'workers/capture/package.json', 'workers/render/requirements.txt']) {
      expect(() => readFileSync(p)).not.toThrow();
    }
    expect(JSON.parse(readFileSync('apps/web/package.json', 'utf8')).dependencies.next).toBeTruthy();
    expect(readFileSync('workers/render/requirements.txt', 'utf8')).toMatch(/opencv/);
  });
});

describe('[F-2] docker compose stack', () => {
  const compose = parse(readFileSync('docker-compose.yml', 'utf8'));

  it('defines every service of the PRD architecture', () => {
    expect(Object.keys(compose.services).sort()).toEqual(
      ['api', 'capture-worker', 'migrate', 'minio', 'minio-bucket', 'postgres', 'redis', 'render-worker', 'web'].sort(),
    );
  });

  it('runs migrations before the API and workers start', () => {
    for (const s of ['api', 'capture-worker', 'render-worker']) {
      expect(compose.services[s].depends_on.migrate.condition).toBe('service_completed_successfully');
    }
  });

  it('is accepted by docker compose', () => {
    let hasDocker = true;
    try {
      execFileSync('docker', ['compose', 'version'], { stdio: 'ignore' });
    } catch {
      hasDocker = false;
    }
    if (hasDocker) expect(() => execFileSync('docker', ['compose', 'config', '-q'], { stdio: 'pipe' })).not.toThrow();
  });
});

describe('[F-8] CI pipeline', () => {
  const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const runs = ci.jobs.test.steps.map((s: any) => s.run ?? '').join('\n');

  it('runs on every push with Postgres and Redis', () => {
    expect(ci.on).toHaveProperty('push');
    expect(Object.keys(ci.jobs.test.services)).toEqual(['postgres', 'redis']);
  });

  it('typechecks and runs the phase gate, which covers every suite', () => {
    expect(runs).toContain('npm run typecheck');
    expect(runs).toContain('scripts/phase-gate.sh "$(cat docs/PHASE)"');
    const gate = readFileSync('scripts/phase-gate.sh', 'utf8');
    expect(gate).toContain('npm test');
    expect(gate).toContain('npm run test:e2e');
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.scripts.test).toBe('npm run test:node && npm run test:py');
  });
});
