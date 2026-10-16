// Static checks on infra/aws/ that a mocked `terraform test` plan can't see: the Terraform version,
// the state backend, and that no secret value sits in a tracked file (#405). Run with
// `node --test infra/aws/tests/`; the terraform workflow runs it next to fmt, validate and tflint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(join(root, p), 'utf8');

// Every .tf / .tfvars file under infra/aws/, skipping provider caches.
function tfFiles(dir = root) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.terraform') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tfFiles(full));
    else if (/\.(tf|tfvars)$/.test(entry.name) || entry.name.endsWith('.tfvars.example')) out.push(full);
  }
  return out;
}

// Strip comments so a note about a rule can't satisfy (or trip) the rule.
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)(#|\/\/).*$/gm, '$1');

function block(text, opener) {
  const start = text.indexOf(opener);
  if (start === -1) return null;
  let depth = 0;
  for (let i = text.indexOf('{', start); i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

test('criterion 1: requires Terraform >= 1.11', () => {
  const tf = code(read('versions.tf'));
  assert.match(tf, /required_version\s*=\s*">=\s*1\.11(\.0)?"/);
});

test('criterion 1: S3 backend with use_lockfile in us-east-1, encrypted', () => {
  const backend = block(code(read('versions.tf')), 'backend "s3"');
  assert.ok(backend, 'versions.tf has a backend "s3" block');
  assert.match(backend, /use_lockfile\s*=\s*true/);
  assert.match(backend, /region\s*=\s*"us-east-1"/);
  assert.match(backend, /encrypt\s*=\s*true/);
  assert.match(backend, /key\s*=\s*"[^"]+\.tfstate"/);
  assert.doesNotMatch(backend, /dynamodb_table/, 'S3 native locking, not the deprecated DynamoDB lock');
});

test('criterion 1: the provider sets default tags in us-east-1', () => {
  const provider = block(code(read('providers.tf')), 'provider "aws"');
  assert.ok(provider, 'providers.tf has a provider "aws" block');
  assert.match(provider, /default_tags\s*\{[\s\S]*tags\s*=/);
  assert.match(code(read('variables.tf')), /variable "region"[\s\S]*?default\s*=\s*"us-east-1"/);
});

test('criterion 1: the bootstrap module is its own root with local state', () => {
  const tf = code(read('bootstrap/main.tf'));
  assert.doesNotMatch(tf, /backend\s+"/, 'the bootstrap creates the state bucket, so it cannot keep state in it');
  assert.match(tf, /required_version\s*=\s*">=\s*1\.11(\.0)?"/);
});

test('criterion 2: no NAT gateway, private subnet or inbound rule on the task group anywhere', () => {
  const all = tfFiles().map((f) => code(readFileSync(f, 'utf8'))).join('\n');
  assert.doesNotMatch(all, /resource\s+"aws_nat_gateway"/);
  assert.doesNotMatch(all, /resource\s+"aws_eip"/);
  assert.doesNotMatch(all, /referenced_security_group_id\s*=\s*aws_security_group\.rds/);
  assert.doesNotMatch(all, /security_group_id\s*=\s*aws_security_group\.task\.id[\s\S]{0,200}?from_port/);
});

test('criterion 3: the master password is managed by RDS, never set', () => {
  const tf = code(read('rds.tf'));
  assert.match(tf, /manage_master_user_password\s*=\s*true/);
  assert.doesNotMatch(tf, /^\s*password\s*=/m);
  assert.doesNotMatch(tf, /random_password/);
});

test('criterion 4: SSM parameters are named, never read or written', () => {
  const all = tfFiles().map((f) => code(readFileSync(f, 'utf8'))).join('\n');
  assert.doesNotMatch(all, /data\s+"aws_ssm_parameter"/, 'a data source would copy the value into state');
  assert.doesNotMatch(all, /resource\s+"aws_ssm_parameter"/, 'a resource would keep the value in state');
  assert.doesNotMatch(all, /data\s+"aws_secretsmanager_secret_version"/);
  const ssm = code(read('ssm.tf'));
  for (const name of ['TUNNEL_TOKEN', 'B2_ACCESS_KEY_ID', 'B2_SECRET_ACCESS_KEY', 'BACKUP_HEARTBEAT_URL', 'SESSION_SECRET']) {
    assert.match(ssm, new RegExp(`"${name}"`), `ssm.tf names ${name}`);
  }
  assert.match(ssm, /"\/satis\/prod\/"/);
});

// Shapes of real secrets and contact data; a placeholder like "you@example.com" is allowed.
const SECRET_SHAPES = [
  [/AKIA[0-9A-Z]{16}/, 'an AWS access key id'],
  [/(secret|password|token)\w*\s*=\s*"[^"$]{8,}"/i, 'a literal secret assignment'],
  [/eyJ[A-Za-z0-9_-]{20,}/, 'a JWT or tunnel token'],
  [/https:\/\/hc-ping\.com\/[0-9a-f-]{20,}/i, 'a heartbeat URL'],
  [/[A-Za-z0-9._%+-]+@(?!example\.(com|org)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'an email address'],
  [/[A-Za-z]:\\Users\\/, 'an absolute local path'],
];

test('criterion 4: no secret value in any tracked .tf or .tfvars file', () => {
  const tracked = execFileSync('git', ['ls-files', '--', '.'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(tf|tfvars)$|\.tfvars\.example$|\.tfbackend(\.example)?$/.test(f));
  // Untracked new files count too, so the check fails before a commit, not after.
  const files = new Set([...tracked.map((f) => join(root, f)), ...tfFiles()]);
  assert.ok(files.size > 0);
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const [re, what] of SECRET_SHAPES) {
      assert.doesNotMatch(text, re, `${relative(root, file)} holds ${what}`);
    }
  }
  assert.ok(!tracked.some((f) => /(^|\/)terraform\.tfvars$|\.tfstate/.test(f)), 'no real tfvars or state is tracked');
});

test('criterion 5: a monthly cost budget alerts an address given at apply time', () => {
  const tf = code(read('budget.tf'));
  assert.match(tf, /resource\s+"aws_budgets_budget"/);
  assert.match(tf, /budget_type\s*=\s*"COST"/);
  assert.match(tf, /subscriber_email_addresses\s*=\s*\[var\.budget_alert_email\]/);
  const variable = block(code(read('variables.tf')), 'variable "budget_alert_email"');
  assert.ok(variable);
  assert.doesNotMatch(variable, /default\s*=/, 'the address is never committed');
});

// #408: the ECS service. The plan-level checks are in ecs.tftest.hcl; these read the source.

test('#408 criterion 1: the backend image is a digest variable, never a tag like :main', () => {
  const all = tfFiles().map((f) => code(readFileSync(f, 'utf8'))).join('\n');
  assert.doesNotMatch(all, /satisfactory-dash-backend:main/);
  const variable = block(code(read('variables.tf')), 'variable "backend_image"');
  assert.ok(variable, 'variables.tf has backend_image');
  assert.doesNotMatch(variable, /default\s*=/, 'the digest is given at apply time');
  assert.match(variable, /@sha256:\[0-9a-f\]\{64\}\$/);
});

test('#408 criterion 1: cloudflared runs the same pinned version and digest as compose.yaml', () => {
  const pin = (text) => text.match(/cloudflare\/cloudflared:[0-9.]+@sha256:[0-9a-f]{64}/g);
  const ecs = pin(code(read('ecs.tf')));
  const compose = pin(readFileSync(join(root, '..', '..', 'compose.yaml'), 'utf8'));
  assert.ok(ecs && ecs.length === 1, 'ecs.tf pins cloudflared once');
  assert.deepEqual(ecs, compose);
});

test('#408 criterion 2: the backend health check uses node, since the image has no curl', () => {
  const tf = code(read('ecs.tf'));
  assert.match(tf, /"CMD",\s*"node",\s*"-e"/);
  assert.doesNotMatch(tf, /curl|wget/);
});

test('#408 criterion 4: no IAM user or access key exists anywhere', () => {
  const all = tfFiles().map((f) => code(readFileSync(f, 'utf8'))).join('\n');
  assert.doesNotMatch(all, /resource\s+"aws_iam_access_key"/);
  assert.doesNotMatch(all, /resource\s+"aws_iam_user"/);
  // #409: the AWS CLI in the restore task reads the per-run Backblaze B2 read key under these names (the
  // backup writes its key to a profile file instead). Each mention must be exactly that mapping, so no
  // AWS key can appear.
  const lines = all.split('\n').filter((l) => /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/.test(l));
  const b2 = [
    /^\s*AWS_ACCESS_KEY_ID\s*=\s*local\.restore_ssm_arns\["B2_READ_KEY_ID"\]\s*$/,
    /^\s*AWS_SECRET_ACCESS_KEY\s*=\s*local\.restore_ssm_arns\["B2_READ_APPLICATION_KEY"\]\s*$/,
  ];
  // The restore script drops the read key from its environment once the download is done.
  const unset = /^\s*unset AGE_IDENTITY AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY\s*$/;
  for (const line of lines) {
    assert.ok(b2.some((re) => re.test(line)) || unset.test(line), `only a B2 key from SSM may be named AWS_*_KEY: ${line.trim()}`);
  }
  assert.equal(lines.filter((l) => !unset.test(l)).length, 2, 'the restore maps one B2 key id and secret');
});

test('#409 criterion 1: only the ops files read Secrets Manager, and only for db-init', () => {
  for (const f of tfFiles()) {
    if (['ops.tf', 'ops_iam.tf'].includes(relative(root, f).replace(/\\/g, '/'))) continue;
    // outputs.tf may print the secret's ARN; no other file grants or injects it.
    assert.doesNotMatch(code(readFileSync(f, 'utf8')), /secretsmanager:|db_master_secret_arn|:password::/, `${relative(root, f)} reads no secret`);
  }
  const ops = code(read('ops.tf'));
  const init = block(ops, '"db-init" = {');
  assert.ok(init, 'ops.tf has a db-init task');
  assert.match(init, /master_secret\s*=\s*true/);
  assert.equal((ops.match(/master_secret\s*=\s*true/g) ?? []).length, 1, 'one task reads the master secret');
});

test('#409 criterion 2: the age private key has no permanent parameter and Terraform never holds it', () => {
  const ssm = code(read('ssm.tf'));
  assert.doesNotMatch(ssm, /AGE_IDENTITY|AGE_SECRET|B2_READ_/, 'ssm.tf names no restore-only value');
  const all = tfFiles().map((f) => code(readFileSync(f, 'utf8'))).join('\n');
  assert.doesNotMatch(all, /resource\s+"aws_secretsmanager_secret/);
  assert.doesNotMatch(all, /AGE-SECRET-KEY-/);
  assert.match(code(read('ops.tf')), /restore_ssm_prefix\s*=\s*"\/satis\/restore\/"/);
});

test('#409: the restore reads the same B2 key prefix the backup writes', () => {
  const backup = readFileSync(join(root, '..', '..', 'backend', 'src', 'platform', 'backup', 'backup.ts'), 'utf8');
  const prefix = backup.match(/export const S3_KEY_PREFIX = "([^"]+)"/)?.[1];
  assert.ok(prefix, 'backup.ts exports S3_KEY_PREFIX');
  assert.ok(code(read('ops.tf')).includes(`"s3://$BACKUP_S3_BUCKET/${prefix}$RESTORE_FILE"`), `the restore downloads from ${prefix}`);
});

test('#409 criterion 3: an EventBridge schedule runs the backup task', () => {
  const tf = code(read('schedule.tf'));
  assert.match(tf, /resource\s+"aws_scheduler_schedule"\s+"backup"/);
  assert.match(tf, /task_definition_arn\s*=\s*aws_ecs_task_definition\.ops\["backup"\]\.arn/);
});

test('#409 criterion 4: the AWS runbook covers apply, deploy, migrate, restore, scale to 0, credits and the backup grant', () => {
  const runbook = readFileSync(join(root, '..', '..', 'docs-vault', 'wiki', 'runbooks', 'aws.md'), 'utf8');
  const sections = ['## Apply', '## Deploy', '## Migrate', '## Restore', '## Scale to 0', '## Monthly credit check', '## Check the backup role'];
  for (const s of sections) assert.ok(runbook.includes(`\n${s}`), `the runbook has "${s}"`);
  for (const needle of [
    'backend_image',
    'terraform apply',
    'satis-prod-ops-db-migrate',
    'satis-prod-ops-restore',
    'RESTORE_FILE',
    '/satis/restore/AGE_IDENTITY',
    'aws ssm delete-parameter',
    '--desired-count 0',
    'aws freetier get-account-plan-state',
    'pg_read_all_data',
  ]) {
    assert.ok(runbook.includes(needle), `the runbook mentions ${needle}`);
  }
  assert.doesNotMatch(runbook, /[A-Za-z]:\\Users\\|AGE-SECRET-KEY-1[0-9A-Z]{10,}/);
});

test('#408 criterion 4: the execution role has no managed policy that would widen it', () => {
  const tf = code(read('iam.tf'));
  assert.doesNotMatch(tf, /aws_iam_role_policy_attachment|managed_policy_arns|AmazonECSTaskExecutionRolePolicy/);
});

test('#408 criterion 5: log groups keep 14 days and Container Insights is off', () => {
  const logs = code(read('logs.tf'));
  const groups = logs.match(/resource\s+"aws_cloudwatch_log_group"/g) ?? [];
  const days = logs.match(/retention_in_days\s*=\s*14\b/g) ?? [];
  assert.ok(groups.length >= 2);
  assert.equal(days.length, groups.length, 'every log group keeps 14 days');
  assert.match(code(read('ecs.tf')), /name\s*=\s*"containerInsights"\s*\n\s*value\s*=\s*"disabled"/);
});

test('the .gitignore keeps state, plans, real tfvars and provider caches out', () => {
  const gi = readFileSync(join(root, '..', '..', '.gitignore'), 'utf8');
  for (const line of ['.terraform/', '*.tfstate', '*.tfstate.*', '*.tfvars', '*.tfplan', '*.tfbackend']) {
    assert.ok(gi.split(/\r?\n/).includes(line), `.gitignore has ${line}`);
  }
});

// #409: the db-init and restore task commands are shell scripts in ops.tf heredocs. Run them for real
// with stub aws, age, pg_restore and npm on PATH, so their checks and hand-offs are tested, not read.
function heredoc(name) {
  const m = read('ops.tf').match(new RegExp(`${name} = <<-EOT\\r?\\n([\\s\\S]*?)\\r?\\n\\s*EOT`));
  assert.ok(m, `ops.tf has the ${name} heredoc`);
  const lines = m[1].split(/\r?\n/);
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  return lines.map((l) => l.slice(indent)).join('\n').replace(/\$\$\{/g, '${');
}

function sandbox(stubs) {
  const dir = mkdtempSync(join(tmpdir(), 'satis-ops-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  for (const [name, body] of Object.entries(stubs)) {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "$STUB_LOG"\n${body}\n`, { mode: 0o755 });
  }
  const log = join(dir, 'calls.log');
  writeFileSync(log, '');
  const sep = process.platform === 'win32' ? ';' : ':';
  return { dir, log, path: `${bin}${sep}${process.env.PATH}` };
}

function runScript(script, box, env) {
  const r = spawnSync('sh', ['-c', script], {
    encoding: 'utf8',
    // The MSYS_* keys stop Git for Windows' sh rewriting /etc/... values for node; Linux ignores them.
    env: { PATH: box.path, STUB_LOG: box.log, TMPDIR: box.dir, MSYS_NO_PATHCONV: '1', MSYS2_ENV_CONV_EXCL: '*', ...env },
  });
  return { code: r.status, stderr: r.stderr, stdout: r.stdout, calls: readFileSync(box.log, 'utf8').trim().split('\n').filter(Boolean) };
}

const RESTORE_ENV = {
  BACKUP_S3_BUCKET: 'example-bucket',
  BACKUP_S3_ENDPOINT: 'https://s3.example-region.backblazeb2.com',
  AGE_IDENTITY: '# test identity\nAGE-SECRET-KEY-PLACEHOLDER',
  AWS_ACCESS_KEY_ID: 'read-key-id',
  AWS_SECRET_ACCESS_KEY: 'read-key-secret',
  RESTORE_DATABASE_URL: 'postgres://satis_migrator:pw@db.example.com:5432/satis?sslmode=verify-full',
};

// age copies the identity it was given next to the output, so the test can read what it received.
const RESTORE_STUBS = {
  aws: 'last=""; for a in "$@"; do last="$a"; done; : > "$last"',
  age: 'while [ $# -gt 0 ]; do case "$1" in --identity) cp "$2" "$STUB_LOG.identity";; --output) : > "$2";; esac; shift; done',
  pg_restore: 'env | grep -c -E "^(AGE_IDENTITY|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY)=" >> "$STUB_LOG.env"; true',
};

test('#409 edge: the restore refuses a missing, path-like or wrongly named RESTORE_FILE before any download', () => {
  const script = heredoc('restore_script');
  for (const file of [undefined, '', '../satis-1.dump.age', 'x/satis-1.dump.age', 'satis-1..dump.age', 'other.dump.age', 'satis-1.dump']) {
    const box = sandbox(RESTORE_STUBS);
    const env = { ...RESTORE_ENV };
    if (file !== undefined) env.RESTORE_FILE = file;
    const r = runScript(script, box, env);
    assert.equal(r.code, 2, `RESTORE_FILE=${file} exits 2`);
    assert.deepEqual(r.calls, [], `RESTORE_FILE=${file} runs nothing`);
    assert.match(r.stderr, /\[restore\]/);
  }
});

test('#409 edge: the restore downloads, decrypts and restores in one transaction, without the keys in pg_restore', () => {
  const box = sandbox(RESTORE_STUBS);
  const r = runScript(heredoc('restore_script'), box, { ...RESTORE_ENV, RESTORE_FILE: 'satis-20261015T090000Z.dump.age' });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.calls.length, 3);
  assert.match(r.calls[0], /^aws s3 cp --only-show-errors --endpoint-url https:\/\/s3\.example-region\.backblazeb2\.com s3:\/\/example-bucket\/satis-dash\/satis-20261015T090000Z\.dump\.age \S+\/backup\.age$/);
  assert.match(r.calls[1], /^age --decrypt --identity \S+\/identity --output \S+\/satis\.dump \S+\/backup\.age$/);
  assert.match(r.calls[2], /^pg_restore --no-owner --single-transaction --dbname postgres:\/\/satis_migrator:pw@db\.example\.com:5432\/satis\?sslmode=verify-full \S+\/satis\.dump$/);
  assert.equal(readFileSync(`${box.log}.identity`, 'utf8'), `${RESTORE_ENV.AGE_IDENTITY}\n`, 'age gets the whole identity, comment line included');
  assert.equal(readFileSync(`${box.log}.env`, 'utf8').trim(), '0', 'pg_restore runs without the age key or the B2 read key');
  assert.deepEqual(readdirSync(box.dir).filter((f) => f.startsWith('tmp.')), [], 'the work folder is removed');
  assert.match(r.stdout, /\[restore\] done: satis-20261015T090000Z\.dump\.age/);
});

test('#409 edge: a failed download or decrypt stops the restore before pg_restore', () => {
  for (const failing of ['aws', 'age']) {
    const box = sandbox({ ...RESTORE_STUBS, [failing]: 'exit 1' });
    const r = runScript(heredoc('restore_script'), box, { ...RESTORE_ENV, RESTORE_FILE: 'satis-1.dump.age' });
    assert.notEqual(r.code, 0, `${failing} failing fails the task`);
    assert.ok(!r.calls.some((c) => c.startsWith('pg_restore')), `no pg_restore after ${failing} fails`);
  }
});

test('#409 edge: db-init builds DATABASE_ADMIN_URL with the master password URL-encoded, then drops the password', () => {
  const box = sandbox({ npm: 'printf "%s\\n" "$DATABASE_ADMIN_URL" > "$STUB_LOG.url"; printf "%s" "${DB_MASTER_PASSWORD-unset}" > "$STUB_LOG.pw"' });
  const password = 'p@ss:w/rd#?%&+ x';
  const r = runScript(heredoc('db_init_script'), box, {
    DB_MASTER_USERNAME: 'satis_admin',
    DB_MASTER_PASSWORD: password,
    DB_HOST: 'satis-prod.example.us-east-1.rds.amazonaws.com',
    DB_PORT: '5432',
    DB_TLS_QUERY: 'sslmode=verify-full&sslrootcert=/etc/ssl/rds/global-bundle.pem',
  });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.calls, ['npm run --silent db:init -w backend']);
  const url = new URL(readFileSync(`${box.log}.url`, 'utf8').trim());
  assert.equal(decodeURIComponent(url.password), password, 'the password survives the round trip');
  assert.equal(url.username, 'satis_admin');
  assert.equal(url.host, 'satis-prod.example.us-east-1.rds.amazonaws.com:5432');
  assert.equal(url.pathname, '/postgres');
  assert.equal(url.searchParams.get('sslmode'), 'verify-full');
  assert.equal(url.searchParams.get('sslrootcert'), '/etc/ssl/rds/global-bundle.pem');
  assert.equal(readFileSync(`${box.log}.pw`, 'utf8'), 'unset', 'db:init never sees DB_MASTER_PASSWORD itself');
});

test('#409 edge: the backup task gives the CLI the satis-backup profile the backup always passes, taking the key from the environment', () => {
  const box = sandbox({
    npm: 'cp "$AWS_CONFIG_FILE" "$STUB_LOG.cfg"; cp "$AWS_SHARED_CREDENTIALS_FILE" "$STUB_LOG.cred"; env | grep -c "^B2_" > "$STUB_LOG.env"; true',
  });
  const r = runScript(heredoc('backup_script'), box, {
    BACKUP_AWS_PROFILE: 'satis-backup',
    AWS_DEFAULT_REGION: 'example-region',
    B2_ACCESS_KEY_ID: 'up-key',
    B2_SECRET_ACCESS_KEY: 'up-secret',
  });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.calls, ['npm run --silent backup -w backend']);
  assert.equal(readFileSync(`${box.log}.cfg`, 'utf8'), '[profile satis-backup]\nregion = example-region\n');
  assert.equal(readFileSync(`${box.log}.cred`, 'utf8'), '[satis-backup]\naws_access_key_id = up-key\naws_secret_access_key = up-secret\n');
  assert.equal(readFileSync(`${box.log}.env`, 'utf8').trim(), '0', 'the key reaches the CLI by its file only');
  // backup.ts defaults the profile to this name; the task must set the same one.
  assert.match(read('ops.tf'), /BACKUP_AWS_PROFILE = "satis-backup"/);
  assert.match(readFileSync(join(root, '../../backend/src/platform/backup/backup.ts'), 'utf8'), /\|\| "satis-backup"/);
});
