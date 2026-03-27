#!/usr/bin/env node

/**
 * Hermes Compatibility Checker
 * Scans src/ for APIs not supported in Hermes/React Native.
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');

const INCOMPATIBLE_PATTERNS = [
  { pattern: /AbortSignal\.timeout/g, name: 'AbortSignal.timeout' },
  { pattern: /structuredClone\s*\(/g, name: 'structuredClone' },
  { pattern: /crypto\.randomUUID/g, name: 'crypto.randomUUID (use expo-crypto instead)' },
  { pattern: /navigator\.sendBeacon/g, name: 'navigator.sendBeacon' },
  { pattern: /window\.requestIdleCallback/g, name: 'window.requestIdleCallback' },
  { pattern: /(?<!\.)queueMicrotask\s*\(/g, name: 'queueMicrotask (partially supported)' },
  { pattern: /\.at\s*\(\s*-?\d+\s*\)/g, name: 'Array.at() (not in older Hermes)' },
  { pattern: /Object\.hasOwn\s*\(/g, name: 'Object.hasOwn (not in older Hermes)' },
  { pattern: /\.replaceAll\s*\(/g, name: 'String.replaceAll (not in older Hermes)' },
  { pattern: /fetch\s*\([^)]*AbortSignal\.timeout/g, name: 'fetch with AbortSignal.timeout' },
];

function getAllFiles(dir, exts = ['.ts', '.tsx']) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(getAllFiles(fullPath, exts));
    } else if (exts.some(ext => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const issues = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { pattern, name } of INCOMPATIBLE_PATTERNS) {
      // Reset regex lastIndex
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        issues.push({ file: filePath, line: i + 1, api: name });
      }
    }
  }

  return issues;
}

console.log('Hermes Compatibility Check');
console.log('Scanning src/ for unsupported APIs...\n');

const files = getAllFiles(SRC_DIR);
let allIssues = [];

for (const file of files) {
  const issues = checkFile(file);
  allIssues = allIssues.concat(issues);
}

if (allIssues.length === 0) {
  console.log(`Scanned ${files.length} files. No Hermes compatibility issues found.`);
  process.exit(0);
} else {
  console.log(`Found ${allIssues.length} Hermes compatibility issue(s):\n`);
  for (const issue of allIssues) {
    const relPath = path.relative(path.join(__dirname, '..'), issue.file);
    console.log(`  FAIL  ${relPath}:${issue.line} — ${issue.api}`);
  }
  console.log('\nFix these issues before building for Hermes.');
  process.exit(1);
}
