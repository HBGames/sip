#!/usr/bin/env node

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import * as p from '@clack/prompts'

const VALID_BUMPS = ['patch', 'minor', 'major']
const args = process.argv.slice(2)

const cliTag = readFlagValue('--tag')
const cliBump = readFlagValue('--bump') ?? args.find((arg) => VALID_BUMPS.includes(arg))
const dryRun = args.includes('--dry-run')
const yes = args.includes('--yes')

function readFlagValue(name) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  return index !== -1 ? args[index + 1] : null
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function run(command, options = {}) {
  const output = execSync(command, {
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
  })
  return typeof output === 'string' ? output.trim() : ''
}

function runMaybe(command, options = {}) {
  if (dryRun) {
    p.log.info(`[dry-run] ${command}`)
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
    p.log.info(`[dry-run] package.json version -> ${version}`)
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
    p.cancel('Working tree is not clean. Commit or stash changes first.')
    process.exit(1)
  }
}

function ensureTagAvailable(tagName) {
  const tagRef = `refs/tags/${tagName}`
  try {
    run(`git rev-parse --verify --quiet ${shellQuote(tagRef)}`)
    p.cancel(`Tag ${tagName} already exists locally.`)
    process.exit(1)
  } catch (error) {
    if (error instanceof Error && error.message.includes('already exists locally')) {
      throw error
    }
  }
  const remoteTag = run(`git ls-remote --tags origin ${shellQuote(tagRef)}`)
  if (remoteTag !== '') {
    p.cancel(`Tag ${tagName} already exists on origin.`)
    process.exit(1)
  }
}

function parseBaseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/)
  if (!match) throw new Error(`Unsupported version format: ${version}`)
  return match.slice(1, 4).map(Number)
}

function bumpVersion(version, bumpType) {
  const [major, minor, patch] = parseBaseVersion(version)
  if (bumpType === 'major') return `${major + 1}.0.0`
  if (bumpType === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

function validateTagLabel(tagLabel) {
  if (tagLabel === 'latest') return
  if (!/^[a-z][a-z0-9-]*$/.test(tagLabel)) {
    p.cancel(`Invalid dist-tag "${tagLabel}". Use lowercase letters, numbers, and hyphens.`)
    process.exit(1)
  }
}

function gitCommitAndTag(tagName) {
  runMaybe('git add package.json', { inherit: true })
  runMaybe(`git commit -m ${shellQuote(`chore: release ${tagName}`)}`, { inherit: true })
  runMaybe(`git tag -a ${shellQuote(tagName)} -m ${shellQuote(tagName)}`, { inherit: true })
}

async function main() {
  p.intro('sip release')

  ensureCleanWorkingTree()

  const branch = getCurrentBranch()
  if (!branch) {
    p.cancel('Cannot release from detached HEAD.')
    process.exit(1)
  }

  const currentVersion = getCurrentVersion()
  const distTag = cliTag ?? (branch === 'main' ? 'latest' : 'next')
  validateTagLabel(distTag)

  if (distTag === 'latest' && branch !== 'main') {
    p.cancel('Stable releases are only allowed from main. Use --tag=next or --tag=dev on other branches.')
    process.exit(1)
  }

  p.log.info(`Current version: ${currentVersion}`)
  p.log.info(`Branch: ${branch}`)
  p.log.info(`Dist tag: ${distTag}`)

  // Prompt for bump type
  let bumpType = cliBump
  if (!bumpType) {
    bumpType = await p.select({
      message: 'Version bump',
      options: VALID_BUMPS.map((bump) => ({
        value: bump,
        label: bump,
        hint: `${currentVersion} → ${bumpVersion(currentVersion, bump)}`,
      })),
    })
    if (p.isCancel(bumpType)) {
      p.cancel('Release cancelled.')
      process.exit(0)
    }
  }

  const nextBaseVersion = bumpVersion(currentVersion, bumpType)
  const prerelease = distTag !== 'latest'
  const releaseVersion = prerelease
    ? `${nextBaseVersion}-${distTag}.${getCurrentCommitHash()}`
    : nextBaseVersion
  const tagName = `v${releaseVersion}`

  ensureTagAvailable(tagName)

  // Verification
  const runVerify = await p.confirm({
    message: 'Run full verification before release?',
    initialValue: true,
  })
  if (p.isCancel(runVerify)) {
    p.cancel('Release cancelled.')
    process.exit(0)
  }

  if (runVerify) {
    const s = p.spinner()
    s.start('Running verification (typecheck, build, docs, tests)...')
    try {
      run('pnpm verify:release', { inherit: false })
      s.stop('Verification passed')
    } catch {
      s.stop('Verification failed')
      p.cancel('Fix the errors above and try again.')
      process.exit(1)
    }
  }

  // Confirmation
  p.note(
    [
      `Version:   ${currentVersion} → ${releaseVersion}`,
      `Tag:       ${tagName}`,
      `Dist tag:  ${distTag}`,
      `Flow:      ${prerelease ? 'temporary branch, push tag only' : 'commit to main, push branch + tag'}`,
    ].join('\n'),
    'Release summary'
  )

  if (!yes) {
    const confirmed = await p.confirm({
      message: dryRun ? 'Continue with dry run?' : 'Publish this release?',
    })
    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Release cancelled.')
      process.exit(0)
    }
  }

  // Execute release
  if (!prerelease) {
    const s = p.spinner()
    s.start('Creating stable release...')
    writePackageVersionMaybe(releaseVersion)
    gitCommitAndTag(tagName)
    runMaybe(`git push origin ${shellQuote(branch)} --follow-tags`, { inherit: false })
    s.stop(`Released ${tagName}`)
    p.outro('Monitor the publish workflow at github.com/standardagents/sip/actions')
    return
  }

  const originalBranch = branch
  const tempBranch = `release/${tagName}`
  let switched = false

  try {
    const s = p.spinner()
    s.start('Creating pre-release...')
    runMaybe(`git switch -c ${shellQuote(tempBranch)}`, { inherit: false })
    switched = !dryRun
    writePackageVersionMaybe(releaseVersion)
    gitCommitAndTag(tagName)
    runMaybe(`git push origin ${shellQuote(tagName)}`, { inherit: false })
    s.stop(`Pre-release tag pushed: ${tagName}`)
    p.outro('Monitor the publish workflow at github.com/standardagents/sip/actions')
  } finally {
    if (switched) {
      run(`git switch ${shellQuote(originalBranch)}`, { inherit: false })
      run(`git branch -D ${shellQuote(tempBranch)}`, { inherit: false })
    }
  }
}

main().catch((error) => {
  p.cancel(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
