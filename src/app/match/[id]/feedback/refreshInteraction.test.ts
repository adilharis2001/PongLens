import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { chromium, type Page } from "playwright";

const enabled = process.env.MATCH_ISSUES_BROWSER_TEST === "1";
const require = createRequire(import.meta.url);
const root = process.cwd();
const oldVersion = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const newVersion = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const state = { role: "owner", matchStatus: "ready", activeIssue: null, events: [], refundableMinutes: 11,
  canPositive: true, canProblem: true, canReprocess: true, canRefund: true, activeProcessingVersionId: oldVersion };

/** Same local production-React harness as admin comparisonInteraction.test.
 * Only Next navigation and remote transport are replaced. The actual form,
 * effects, media signing, reconciliation and HTMLVideoElement are exercised. */
function browserBundle() {
  const factories: Record<string, string> = {};
  const packageFile = (name: string, file: string) => path.join(path.dirname(require.resolve(name)), "cjs", file);
  const packages: Record<string, string> = {
    react: packageFile("react", "react.production.js"),
    "react/jsx-runtime": packageFile("react", "react-jsx-runtime.production.js"),
    "react-dom": packageFile("react-dom", "react-dom.production.js"),
    "react-dom/client": packageFile("react-dom", "react-dom-client.production.js"),
    scheduler: packageFile("scheduler", "scheduler.production.js"),
  };
  const stubs: Record<string, string> = {
    "next/link": "module.exports={__esModule:true,default:'a'};",
    "next/navigation": "exports.useRouter=()=>window.fixtureRouter;",
    "@/lib/supabase/client": "exports.createClient=()=>{throw new Error('Unexpected database call in feedback fixture');};",
  };
  const add = (id: string): string => {
    if (id in factories) return id;
    factories[id] = "";
    const source = id in stubs ? stubs[id] : id in packages ? readFileSync(packages[id], "utf8")
      : ts.transpileModule(readFileSync(id, "utf8"), { fileName: id, compilerOptions: {
        module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
      } }).outputText;
    const dependencies: Record<string, string> = {};
    for (const match of source.matchAll(/require\(["']([^"']+)["']\)/g)) {
      const dependency = match[1];
      let resolved = dependency;
      if (!(dependency in stubs) && (dependency.startsWith(".") || dependency.startsWith("@/"))) {
        const base = dependency.startsWith("@/") ? path.join(root, "src", dependency.slice(2)) : path.resolve(path.dirname(id), dependency);
        resolved = [base, base + ".ts", base + ".tsx"].find(file => existsSync(file))!;
        if (!resolved) throw new Error("Cannot resolve " + dependency);
      }
      dependencies[dependency] = add(resolved);
    }
    factories[id] = `function(module,exports,load){const dependencies=${JSON.stringify(dependencies)};const require=id=>load(dependencies[id]);${source}\n}`;
    return id;
  };
  const entry = add(path.join(root, "src/app/match/[id]/feedback/MatchFeedback.tsx"));
  add("react-dom/client"); add("react");
  return `(()=>{const process={env:{NODE_ENV:'production'}};const factories={${Object.entries(factories).map(([id, code]) => `${JSON.stringify(id)}:${code}`).join(",")}};
    const cache={};const load=id=>{if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;factories[id](module,module.exports,load);return module.exports;};
    const React=load('react'),createRoot=load('react-dom/client').createRoot,components=load(${JSON.stringify(entry)});
    window.fixtureState=${JSON.stringify(state)};window.refreshes=0;
    const link=createRoot(document.getElementById('link'));
    window.renderLink=()=>link.render(React.createElement(components.MatchFeedbackLink,{matchId:'match',isOwner:true,matchStatus:'ready',activeVersionId:window.fixtureState.activeProcessingVersionId}));
    window.fixtureRouter={refresh:()=>{window.refreshes++;window.renderLink();}};window.renderLink();
    createRoot(document.getElementById('root')).render(React.createElement(components.MatchFeedback,{matchId:'match',initialState:window.fixtureState,isOwner:true,matchStatus:'ready',title:'Demo match',detail:'Training',hasCut:true,hasOriginal:false,thumbnail:null}));})();`;
}

async function harness(run: (page: Page, signs: string[], expected: string[]) => Promise<void>, publishBeforeSigning = false) {
  const directory = mkdtempSync(path.join(tmpdir(), "ponglens-feedback-refresh-"));
  let video: Buffer;
  try {
    const file = path.join(directory, "fixture.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=black:s=160x90:r=10", "-t", "5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", file]);
    video = readFileSync(file);
  } finally { rmSync(directory, { recursive: true }); }
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 393, height: 660 } });
  const signs: string[] = [];
  const expected: string[] = [];
  let published = false;
  try {
    await page.route("**/*", async route => {
      const url = route.request().url();
      if (!url.startsWith("https://ponglens.test/")) return route.abort();
      if (url.includes("/api/match-issues/")) return route.fulfill({ json: { state: await page.evaluate("window.fixtureState") } });
      if (url.includes("/api/media-url")) {
        const input = route.request().postDataJSON();
        expected.push(input.expectedVersionId);
        if (publishBeforeSigning && !published) {
          published = true;
          await page.evaluate(`window.fixtureState.activeProcessingVersionId=${JSON.stringify(newVersion)}`);
        }
        const version = await page.evaluate<string>("window.fixtureState.activeProcessingVersionId");
        if (input.expectedVersionId !== version) {
          return route.fulfill({ status: 409, json: { error: "Match version changed", code: "active_version_changed" } });
        }
        signs.push(version);
        return route.fulfill({ json: { url: `https://ponglens.test/media/${version}.mp4` } });
      }
      if (url.includes("/media/")) return route.fulfill({ contentType: "video/mp4", body: video });
      return route.fulfill({ contentType: "text/html", body: '<div id="link"></div><div id="root"></div>' });
    });
    await page.goto("https://ponglens.test/");
    await page.addScriptTag({ content: browserBundle() });
    await page.waitForFunction("document.querySelector('video')?.readyState >= 1");
    await run(page, signs, expected);
  } finally { await browser.close(); }
}

async function focusRefresh(page: Page) {
  const response = page.waitForResponse("**/api/match-issues/*");
  await page.evaluate("window.dispatchEvent(new Event('focus'))");
  await response;
  await page.waitForTimeout(100);
}

test("feedback polling preserves its real player and draft; publish and restore replace media", { skip: !enabled }, async () => {
  await harness(async (page, signs) => {
    await page.getByRole("radio", { name: /Try processing again/ }).check();
    await page.getByRole("textbox").fill("Keep my unfinished explanation.");
    await page.evaluate("window.previousVideo=document.querySelector('video');window.previousVideo.muted=true;window.previousVideo.currentTime=1;window.previousVideo.play()");
    await page.waitForFunction("window.previousVideo.currentTime>=1 && !window.previousVideo.paused");
    const before = await page.evaluate<number>("window.previousVideo.currentTime");
    await focusRefresh(page);
    const after = await page.evaluate<{same: boolean; time: number; paused: boolean}>("({same:document.querySelector('video')===window.previousVideo,time:window.previousVideo.currentTime,paused:window.previousVideo.paused})");
    assert.equal(after.same, true);
    assert.ok(after.time >= before, JSON.stringify({before, after}));
    assert.equal(after.paused, false);
    assert.equal(await page.getByRole("textbox").inputValue(), "Keep my unfinished explanation.");
    assert.deepEqual(signs, [oldVersion]);
    await page.evaluate(`window.fixtureState.activeProcessingVersionId=${JSON.stringify(newVersion)}`);
    await focusRefresh(page);
    await page.waitForFunction("document.querySelector('video')?.src.includes('bbbbbbbb')");
    assert.equal(await page.evaluate("document.querySelector('video')===window.previousVideo"), false);
    assert.equal(await page.getByRole("textbox").inputValue(), "Keep my unfinished explanation.");
    await page.evaluate(`window.fixtureState.activeProcessingVersionId=${JSON.stringify(oldVersion)}`);
    await focusRefresh(page);
    await page.waitForFunction("document.querySelector('video')?.src.includes('aaaaaaaa')");
    assert.deepEqual(signs, [oldVersion, newVersion, oldVersion]);
  });
});

test("ready match Tools requests a server refresh only for published or restored active IDs", { skip: !enabled }, async () => {
  await harness(async page => {
    await focusRefresh(page);
    assert.equal(await page.evaluate("window.refreshes"), 0);
    for (const [version, count] of [[newVersion, 1], [oldVersion, 2]] as const) {
      await page.evaluate(`window.fixtureState.activeProcessingVersionId=${JSON.stringify(version)}`);
      await focusRefresh(page);
      await page.waitForFunction(`window.refreshes === ${count}`);
      await focusRefresh(page);
      assert.equal(await page.evaluate("window.refreshes"), count);
    }
  });
});

test("a publish before signing refreshes canonical feedback state and retries with the new expected ID", { skip: !enabled }, async () => {
  await harness(async (page, signs, expected) => {
    assert.deepEqual(expected, [oldVersion, newVersion]);
    assert.deepEqual(signs, [newVersion], "no mismatched cut is ever signed or shown");
    assert.equal(await page.evaluate("document.querySelector('video').src.includes('bbbbbbbb')"), true);
  }, true);
});
