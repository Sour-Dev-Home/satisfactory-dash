// Static checks on infra/aws/ that a mocked `terraform test` plan can't see: the Terraform version,
// the state backend, and that no secret value sits in a tracked file (#405). Run with
// `node --test infra/aws/tests/`; the terraform workflow runs it next to fmt, validate and tflint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
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
  assert.doesNotMatch(all, /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/);
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
