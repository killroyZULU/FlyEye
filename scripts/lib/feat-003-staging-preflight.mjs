import { createHash } from 'node:crypto';

import {
  requireFeat003ReviewedStagingManifest,
  requireFeat003ReviewedStagingTarget,
} from './feat-003-staging-manifest.mjs';

const artifactNames = ['configuration', 'edge', 'frontend', 'lockfile', 'migrations'];
const operations = [
  'migrations',
  'configuration',
  'functions',
  'fixtures',
  'frontend',
  'checkpoint',
  'redeployment',
];
const targetKeys = [
  'cloudflareAccountId',
  'supabaseOrganizationId',
  'pagesProjectId',
  'pagesProjectName',
  'supabaseProjectName',
  'region',
  'plan',
  'monthlyCeilingUsd',
  'projectRef',
  'apiOrigin',
  'databaseHost',
  'frontendOrigin',
];
const digestPattern = /^[a-f0-9]{64}$/;
const revisionPattern = /^[a-f0-9]{40}$/;
const referencePattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/#-]{0,199}$/;
const mapSize = Object.getOwnPropertyDescriptor(Map.prototype, 'size').get;
const mapGet = Map.prototype.get;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const byteArrayTag = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag).get;
const byteArrayLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength').get;
const copyBytes = Uint8Array.prototype.set;

function requireCondition(condition) {
  if (!condition) throw new Error('Invalid preflight input.');
}

function exactFields(value, expected) {
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value));
  const keys = Object.keys(value);
  requireCondition(
    keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key)),
  );
}

function matches(value, pattern) {
  requireCondition(typeof value === 'string' && pattern.test(value));
}

function parse(text) {
  requireCondition(typeof text === 'string' && text.length <= 65536);
  return JSON.parse(text);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function validateTarget(target, manifest) {
  exactFields(target, targetKeys);
  requireFeat003ReviewedStagingTarget(target);
  matches(target.cloudflareAccountId, /^[a-f0-9]{32}$/);
  matches(target.supabaseOrganizationId, /^[a-z0-9]{20}$/);
  matches(target.pagesProjectId, /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
  matches(target.pagesProjectName, /^[a-z0-9][a-z0-9-]{0,62}$/);
  requireCondition(target.supabaseProjectName === target.pagesProjectName);
  requireCondition(
    target.region === 'ap-southeast-1' && target.plan === 'free' && target.monthlyCeilingUsd === 0,
  );
  for (const key of ['projectRef', 'apiOrigin', 'databaseHost', 'frontendOrigin']) {
    requireCondition(target[key] === manifest[key]);
  }
  requireCondition(target.frontendOrigin === `https://${target.pagesProjectName}.pages.dev`);
}

function validatePackage(run, manifest, manifestText, checkoutRevision) {
  exactFields(run, [
    'schemaVersion',
    'environment',
    'dataClassification',
    'target',
    'sourceRevision',
    'manifestSha256',
    'artifacts',
    'operations',
    'approvals',
  ]);
  requireCondition(
    run.schemaVersion === 1 &&
      run.environment === 'staging' &&
      run.dataClassification === 'synthetic-only',
  );
  validateTarget(run.target, manifest);
  matches(checkoutRevision, revisionPattern);
  matches(run.sourceRevision, revisionPattern);
  requireCondition(run.sourceRevision === checkoutRevision);
  matches(run.manifestSha256, digestPattern);
  requireCondition(run.manifestSha256 === sha256(manifestText));
  requireCondition(Array.isArray(run.operations) && run.operations.length === operations.length);
  requireCondition(run.operations.every((operation, index) => operation === operations[index]));
  exactFields(run.approvals, ['creation', 'deployment']);
  matches(run.approvals.creation, referencePattern);
  matches(run.approvals.deployment, referencePattern);
  requireCondition(run.approvals.creation !== run.approvals.deployment);
}

function validateReview(review, run, packageText, manifest) {
  exactFields(review, ['schemaVersion', 'target', 'sourceRevision', 'packageSha256', 'approvals']);
  requireCondition(review.schemaVersion === 1);
  validateTarget(review.target, manifest);
  requireCondition(targetKeys.every((key) => review.target[key] === run.target[key]));
  requireCondition(review.sourceRevision === run.sourceRevision);
  matches(review.packageSha256, digestPattern);
  requireCondition(review.packageSha256 === sha256(packageText));
  exactFields(review.approvals, ['creation', 'deployment']);
  requireCondition(
    review.approvals.creation === run.approvals.creation &&
      review.approvals.deployment === run.approvals.deployment,
  );
}

function validateArtifacts(artifacts, contents) {
  requireCondition(Array.isArray(artifacts) && artifacts.length === artifactNames.length);
  // Native slot checks reject proxies and avoid supplied accessors/method overrides.
  requireCondition(mapSize.call(contents) === artifactNames.length);
  const seen = new Set();
  for (const artifact of artifacts) {
    exactFields(artifact, ['name', 'sha256']);
    requireCondition(artifactNames.includes(artifact.name) && !seen.has(artifact.name));
    seen.add(artifact.name);
    matches(artifact.sha256, digestPattern);
    const bytes = mapGet.call(contents, artifact.name);
    requireCondition(byteArrayTag.call(bytes) === 'Uint8Array');
    const length = byteArrayLength.call(bytes);
    requireCondition(length > 0);
    const snapshot = new Uint8Array(length);
    copyBytes.call(snapshot, bytes);
    requireCondition(sha256(snapshot) === artifact.sha256);
  }
}

/** Offline consistency only. The separate review record is not an authenticated approval.
 * No paths, credentials, callbacks or execution capabilities are accepted here.
 */
export function validateFeat003StagingPreflight(
  manifestText,
  packageText,
  reviewText,
  artifactContents,
  checkoutRevision,
) {
  try {
    const manifest = requireFeat003ReviewedStagingManifest(parse(manifestText));
    const run = parse(packageText);
    validatePackage(run, manifest, manifestText, checkoutRevision);
    validateReview(parse(reviewText), run, packageText, manifest);
    validateArtifacts(run.artifacts, artifactContents);
    return Object.freeze({ status: 'consistent', executionAuthorized: false });
  } catch {
    // Never echo input, JSON parser details, target identities or artifact contents.
    throw new Error('FEAT-003 staging preflight rejected.');
  }
}
