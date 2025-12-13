import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import process from "node:process"
import JavaScriptObfuscator from "javascript-obfuscator"

const src = resolve(process.cwd(), "src/public/pageWorld.js")
const out = resolve(process.cwd(), "src/public/pageWorld.obf.js")

const code = await readFile(src, "utf-8")

const options = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  identifierNamesGenerator: "mangled",
  renameGlobals: false,
  selfDefending: false,
  sourceMap: false,
  stringArray: true,
  stringArrayEncoding: ["base64"],
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 0.75,
  splitStrings: true,
  splitStringsChunkLength: 10,
  transformObjectKeys: false,
  reservedStrings: [
    "SPL_CAPTIONS_FOUND",
    "SPL_REQUEST_CAPTIONS",
    ".ytp-subtitles-button",
    ".html5-video-player",
    "timedtext",
    "pot=",
    "v="
  ]
}

const result = JavaScriptObfuscator.obfuscate(code, options)
await writeFile(out, result.getObfuscatedCode(), "utf-8")

