#!/usr/bin/env node

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'

const VALID_BUMPS = new Set(['major', 'minor', 'patch'])
const args = process.argv.slice(2)

const cliTag = readFlagValue('--tag')
const cliBump = readFlagValue('--bump') ?? args.find((arg) => VALID_BUMPS.has(arg))
const dryRun = args.includes('--dry-run')
const yes = args.includes('--yes')

function readFlagValue(name) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) {
    return inline.slice(name.length + 1)
  }

  const index = args.indexOf(name)
  if (index !== -1) {
    return args[index + 1]
  }

  return null
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function run(command, options = {}) {
  return execSync(command, {
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
  }).trim()
}

function runMaybe(command, options = {}) {
  if (dryRun) {
    console.log(`[dry-run] ${command}`)
    return ''
  }

  return run(command, options)
}

function readPackageJson() {
  return JSON.parse(readFileSync('package.json', 'utf8'))
}

function writePackageVersion(version) {
  const pkg = readPackageJson()
  pkg.version = version
  writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`)
}

function writePackageVersionMaybe(version) {
  if (dryRun) {
    console.log(`[dry-run] package.json version -> ${version}`)
    return
  }

  writePackageVersion(version)
}

function getCurrentVersion() {
  return readPackageJson().version
}

function getCurrentBranch() {
  return run('git branch --show-current')
}

function getCurrentCommitHash(length = 5) {
  return run(`git rev-parse --short=${length} HEAD`)
}

function ensureCleanWorkingTree() {
  const status = run('git status --porcelain')
  if (status !== '') {
    throw new Error('Working tree is not clean. Commit or stash changes before releasing.')
  }
}

function ensureTagAvailable(tagName) {
  const tagRef = `refs/tags/${tagName}`

  try {
    run(`git rev-parse --verify --quiet ${shellQuote(tagRef)}`)
    throw new Error(`Tag ${tagName} already exists locally.`)
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('already exists locally')) {
      // git rev-parse exits non-zero when the tag does not exist, which is expected.
    } else {
      throw error
    }
  }

  const remoteTag = run(`git ls-remote --tags origin ${shellQuote(tagRef)}`)
  if (remoteTag !== '') {
    throw new Error(`Tag ${tagName} already exists on origin.`)
  }
}

function parseBaseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/)
  if (!match) {
    throw new Error(`Unsupported version format: ${version}`)
  }

  return match.slice(1, 4).map((part) => Number(part))
}

function bumpVersion(version, bumpType) {
  const [major, minor, patch] = parseBaseVersion(version)

  if (bumpType === 'major') {
    return `${major + 1}.0.0`
  }

  if (bumpType === 'minor') {
    return `${major}.${minor + 1}.0`
  }

  return `${major}.${minor}.${patch + 1}`
}

function validateTagLabel(tagLabel) {
  if (tagLabel === 'latest') {
    return
  }

  if (!/^[a-z][a-z0-9-]*$/.test(tagLabel)) {
    throw new Error(`Invalid dist-tag "${tagLabel}". Use lowercase letters, numbers, and hyphens.`)
  }
}

async function promptForBump(currentVersion) {
  if (cliBump) {
    if (!VALID_BUMPS.has(cliBump)) {
      throw new Error(`Invalid bump type "${cliBump}". Use major, minor, or patch.`)
    }
    return cliBump
  }

  const choices = [
    ['1', 'patch', `${currentVersion} -> ${bumpVersion(currentVersion, 'patch')}`],
    ['2', 'minor', `${currentVersion} -> ${bumpVersion(currentVersion, 'minor')}`],
    ['3', 'major', `${currentVersion} -> ${bumpVersion(currentVersion, 'major')}`],
  ]

  console.log('Select version bump:')
  for (const [index, name, preview] of choices) {
    console.log(`  ${index}. ${name} (${preview})`)
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    while (true) {
      const answer = (await rl.question('Choice [1-3]: ')).trim()
      const selected = choices.find(([index]) => index === answer)
      if (selected) {
        return selected[1]
      }
    }
  } finally {
    rl.close()
  }
}

async function confirmRelease(summaryLines) {
  if (yes) {
    return true
  }

  console.log('')
  for (const line of summaryLines) {
    console.log(line)
  }
  console.log('')

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await rl.question(dryRun ? 'Continue with dry run? [y/N] ' : 'Continue with release? [y/N] ')).trim().toLowerCase()
    return answer === 'y' || answer === 'yes'
  } finally {
    rl.close()
  }
}

function runVerification() {
  console.log('\nRunning local release verification...\n')
  run('pnpm verify:release', { inherit: true })
}

function gitCommitAndTag(tagName) {
  runMaybe('git add package.json', { inherit: true })
  runMaybe(`git commit -m ${shellQuote(`chore: release ${tagName}`)}`, { inherit: true })
  runMaybe(`git tag -a ${shellQuote(tagName)} -m ${shellQuote(tagName)}`, { inherit: true })
}

async function main() {
  ensureCleanWorkingTree()

  const branch = getCurrentBranch()
  if (!branch) {
    throw new Error('Cannot release from detached HEAD.')
  }

  const currentVersion = getCurrentVersion()
  const distTag = cliTag ?? (branch === 'main' ? 'latest' : 'next')
  validateTagLabel(distTag)

  if (distTag === 'latest' && branch !== 'main') {
    throw new Error('Stable releases are only allowed from main. Use --tag=next or --tag=dev on other branches.')
  }

  const bumpType = await promptForBump(currentVersion)
  const nextBaseVersion = bumpVersion(currentVersion, bumpType)
  const prerelease = distTag !== 'latest'
  const releaseVersion = prerelease
    ? `${nextBaseVersion}-${distTag}.${getCurrentCommitHash()}`
    : nextBaseVersion
  const tagName = `v${releaseVersion}`

  ensureTagAvailable(tagName)

  runVerification()

  const confirmed = await confirmRelease([
    `Current branch: ${branch}`,
    `Current version: ${currentVersion}`,
    `Release version: ${releaseVersion}`,
    `Git tag: ${tagName}`,
    `npm dist-tag: ${distTag}`,
    prerelease
      ? 'Flow: temporary tagged prerelease commit, push tag only, restore local branch'
      : 'Flow: commit version bump on main, push branch and tag',
  ])

  if (!confirmed) {
    console.log('\nRelease cancelled.')
    return
  }

  if (!prerelease) {
    console.log('\nCreating stable release...\n')
    writePackageVersionMaybe(releaseVersion)
    gitCommitAndTag(tagName)
    runMaybe(`git push origin ${shellQuote(branch)} --follow-tags`, { inherit: true })
    console.log(`\nRelease pushed: ${tagName}`)
    console.log('Monitor the publish workflow in GitHub Actions.')
    return
  }

  const originalBranch = branch
  const tempBranch = `release/${tagName}`
  let switched = false

  try {
    runMaybe(`git switch -c ${shellQuote(tempBranch)}`, { inherit: true })
    switched = !dryRun

    writePackageVersionMaybe(releaseVersion)
    gitCommitAndTag(tagName)
    runMaybe(`git push origin ${shellQuote(tagName)}`, { inherit: true })

    console.log(`\nPre-release tag pushed: ${tagName}`)
    console.log('Monitor the publish workflow in GitHub Actions.')
  } finally {
    if (switched) {
      run(`git switch ${shellQuote(originalBranch)}`, { inherit: true })
      run(`git branch -D ${shellQuote(tempBranch)}`, { inherit: true })
    }
  }
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
