/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function safeExec(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function maybeExpandGitHistory(limit) {
  try {
    const isShallow = safeExec("git rev-parse --is-shallow-repository");
    if (String(isShallow).toLowerCase().includes("true")) {
      // Try to deepen or unshallow; ignore failures
      safeExec("git fetch --tags --prune --deepen=" + limit);
      safeExec("git fetch --unshallow --tags --prune");
    }
  } catch {
    // ignore
  }
}

function getBranchName() {
  return (
    process.env.GITHUB_REF_NAME || safeExec("git rev-parse --abbrev-ref HEAD")
  );
}

function getRepositorySlug() {
  return process.env.GITHUB_REPOSITORY || ""; // owner/repo
}

function getCommits(limit) {
  const format = "%H%x1f%an%x1f%ad%x1f%s%x1f%b%x1e"; // record sep 0x1e, field sep 0x1f
  const raw = safeExec(
    `git log --date=iso --pretty=format:${format} -n ${limit}`
  );
  if (!raw) return [];
  return raw
    .split("\x1e")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((rec) => {
      const [hash, author, dateIso, subject, body] = rec.split("\x1f");
      return {
        commitFull: hash,
        commit: hash ? hash.slice(0, 7) : "",
        author: author || "",
        dateIso: dateIso || new Date().toISOString(),
        // keep legacy 'message' as the subject/title for backwards compatibility
        message: subject || "",
        title: subject || "",
        body: (body || "").trim(),
      };
    });
}

function main() {
  try {
    const limit = Number(process.env.CHANGELOG_LIMIT || 200);
    maybeExpandGitHistory(limit);
    const publicDir = path.join(__dirname, "..", "public");
    fs.mkdirSync(publicDir, { recursive: true });
    const payload = {
      branch: getBranchName(),
      repository: getRepositorySlug(),
      generatedAtIso: new Date().toISOString(),
      commits: getCommits(limit),
    };
    const outPath = path.join(publicDir, "changelog.json");
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
    console.log("changelog.json written:", outPath);
  } catch (e) {
    console.error("Failed to write changelog.json", e);
    process.exitCode = 0; // do not fail the build if this step fails
  }
}

main();
