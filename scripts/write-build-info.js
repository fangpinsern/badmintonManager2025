/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

function writeBuildInfo() {
  try {
    const outPath = path.join(__dirname, "..", "src", "buildInfo.ts");
    const deployedAtIso = new Date().toISOString();
    const content = `export const deployedAtIso = '${deployedAtIso}';\n`;
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content, "utf8");
    console.log("buildInfo.ts written:", deployedAtIso);
  } catch (e) {
    console.error("Failed to write buildInfo.ts", e);
    process.exitCode = 0; // do not fail the build if this step fails
  }
}

writeBuildInfo();
