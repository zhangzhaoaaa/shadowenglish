import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import process from "node:process"

const src = resolve(process.cwd(), "src/public/pageWorld.js")
const out = resolve(process.cwd(), "src/public/pageWorld.inject.js")

const code = await readFile(src, "utf-8")

await writeFile(out, code, "utf-8")
