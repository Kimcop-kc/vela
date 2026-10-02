import fs from 'node:fs'

const tag = process.argv[2]
const outputPath = process.argv[3] ?? 'release-notes.md'

if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
  console.error('Usage: node scripts/extract-release-notes.mjs vX.Y.Z [output.md]')
  process.exit(1)
}

const version = tag.slice(1)
const changelog = fs.readFileSync('CHANGELOG.md', 'utf8').replace(/\r\n/g, '\n')
const lines = changelog.split('\n')
const start = lines.findIndex(line => line.trim().startsWith(`## [${version}]`))

if (start < 0) {
  console.error(`CHANGELOG.md is missing a section for ${version}`)
  process.exit(1)
}

let end = lines.length
for (let index = start + 1; index < lines.length; index++) {
  if (/^## \[/.test(lines[index].trim())) {
    end = index
    break
  }
}

const section = lines.slice(start, end).join('\n').trim()
const body = section
  .replace(/^## \[[^\]]+\][^\n]*\n+/, '')
  .replace(/\n+---\s*$/, '')
  .trim()

if (!body) {
  console.error(`CHANGELOG.md section for ${version} is empty`)
  process.exit(1)
}

fs.writeFileSync(outputPath, body + '\n', 'utf8')
console.log(`Release notes written to ${outputPath}`)
