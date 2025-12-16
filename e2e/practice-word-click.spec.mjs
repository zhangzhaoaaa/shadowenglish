import { test, expect, chromium } from "@playwright/test"
import path from "path"
import http from "http"
import fs from "fs"
import url from "url"

test.describe("Practice word interactions", () => {
  test("clicking a word plays from that word and highlights active", async () => {
    const browser = await chromium.launch()
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.addInitScript(() => {
      const listeners = new Set()
      const pending = []
      const log = []
      const onMessage = {
        addListener: (cb) => {
          listeners.add(cb)
          while (pending.length) {
            const p = pending.shift()
            cb(p, {}, () => {})
          }
        }
      }

      const broadcast = (payload) => {
        log.push(payload)
        if (listeners.size === 0) pending.push(payload)
        else listeners.forEach((fn) => fn(payload, {}, () => {}))
      }

      const sendMessage = (payload, cb) => {
        const type = payload && payload.type
        if (type === "spl-get-tab-id") {
          if (typeof cb === "function") cb({ tabId: null })
          return
        }
        if (type === "spl-get-initial-state") {
          if (typeof cb === "function") cb({ currentTime: 0, isReady: true, speed: 1, segments: [], currentLanguage: "en" })
          return
        }
        broadcast(payload)
        if (typeof cb === "function") cb({ tabId: null })
      }

      const storageLocal = {
        get: (_keys, cb) => cb({}),
        set: () => {}
      }

      const tabs = {
        sendMessage: (_tabId, msg) => broadcast(msg)
      }

      window.chrome = {
        runtime: { onMessage, sendMessage, getManifest: () => ({}) },
        storage: { local: storageLocal },
        tabs
      }

      window.__messages = log
    })

    const root = path.resolve("build/chrome-mv3-prod")
    const server = http.createServer((req, res) => {
      const parsed = url.parse(req.url)
      let pathname = parsed.pathname || "/"
      if (pathname === "/") pathname = "/sidepanel.html"
      const filePath = path.join(root, pathname)
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.statusCode = 404
          res.end("Not Found")
          return
        }
        res.statusCode = 200
        res.end(data)
      })
    })
    await new Promise((resolve) => server.listen(0, resolve))
    const port = server.address().port
    await page.goto(`http://127.0.0.1:${port}/sidepanel.html`)
    await page.waitForSelector('h1:text("Shadowing Practice Loop")')

    await page.evaluate(() => {
      const segs = [
        { startSeconds: 0, endSeconds: 2, text: "So, I'm going to show you" },
        { startSeconds: 2, endSeconds: 4, text: "all of the prompts in order" },
        { startSeconds: 4, endSeconds: 6, text: "so that you can replicate" }
      ]
      chrome.runtime.sendMessage({ type: "spl-segments-updated", segments: segs })
      chrome.runtime.sendMessage({ type: "spl-state-updated", state: { isReady: true, currentTime: 0, speed: 1, currentLanguage: "en", isPlaying: false } })
    })

    await page.waitForSelector('article.prose')
    await page.waitForSelector('[data-idx="0"]')

    await page.evaluate(() => {
      const group = document.querySelector('[data-idx="0"] p')
      const walker = document.createTreeWalker(group, NodeFilter.SHOW_TEXT)
      const nodes = []
      while (walker.nextNode()) nodes.push(walker.currentNode)
      const target = nodes.find((n) => (n.nodeValue || "").includes("all of the prompts"))
      const start = (target.nodeValue || "").indexOf("all of the prompts")
      const end = start + "all of the prompts".length
      const r = document.createRange()
      r.setStart(target, start)
      r.setEnd(target, end)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(r)
      group.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
    })

    const clicked = await page.evaluate(() => {
      const host = document.querySelector('div.w-full.flex-shrink-0.rounded-lg.border.bg-card.p-4')
      const spans = host.querySelectorAll('span[data-practice-token-index]')
      const target = Array.from(spans).find((el) => el.textContent.trim() === 'prompts')
      if (target) {
        target.click()
        return true
      }
      return false
    })
    expect(clicked).toBe(true)
    await page.waitForTimeout(50)

    const msgs = await page.evaluate(() => window.__messages)
    const last = msgs.filter((m) => m && (m.type === 'spl-play-period' || m.type === 'spl-play-segment')).pop()
    expect(last.type).toBe('spl-play-period')
    expect(last.start).toBe(2)
    expect(last.end).toBe(4)

    await page.evaluate(() => {
      chrome.runtime.sendMessage({ type: "spl-state-updated", state: { currentTime: 2.5, isPlaying: true } })
    })
    await page.waitForTimeout(50)

    await context.close()
    await browser.close()
    server.close()
  })
})
