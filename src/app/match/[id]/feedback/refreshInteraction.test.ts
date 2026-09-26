import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
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
 * its effects and the row's refresh are exercised. */
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
    // Dictation needs the consent provider the app wraps pages in; the
    // form's own behaviour is what is under test here.
    "@/components/DictateButton": "exports.DictateButton=()=>null;",
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
    createRoot(document.getElementById('root')).render(React.createElement(components.MatchFeedback,{matchId:'match',initialState:window.fixtureState,isOwner:true,matchStatus:'ready',title:'Demo match',detail:'Training',titleFacts:{opponentName:'Demo',venue:null,playedAt:null,matchType:'match'},hasOriginal:false,thumbnail:null}));})();`;
}

/*
 * The page used to carry its own video player, and these tests waited for
 * it and signed its media. The player went (the video it asks about is on
 * the match page), so the harness now waits for the form, and the two
 * media tests became one about the draft (post-rollout audit R3,
 * 2026-09-26: they had been timing out since, unnoticed, because no npm
 * script ran them).
 */
async function harness(run: (page: Page) => Promise<void>) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 393, height: 660 } });
  try {
    await page.route("**/*", async route => {
      const url = route.request().url();
      if (!url.startsWith("https://ponglens.test/")) return route.abort();
      if (url.includes("/api/match-issues/")) return route.fulfill({ json: { state: await page.evaluate("window.fixtureState") } });
      return route.fulfill({ contentType: "text/html", body: '<div id="link"></div><div id="root"></div>' });
    });
    await page.goto("https://ponglens.test/");
    await page.addScriptTag({ content: browserBundle() });
    await page.waitForFunction("document.querySelector('form textarea') !== null");
    await run(page);
  } finally { await browser.close(); }
}

async function focusRefresh(page: Page) {
  const response = page.waitForResponse("**/api/match-issues/*");
  await page.evaluate("window.dispatchEvent(new Event('focus'))");
  await response;
  await page.waitForTimeout(100);
}

test("feedback polling preserves the chosen request and the draft", { skip: !enabled }, async () => {
  await harness(async page => {
    assert.equal(await page.getByRole("heading", { level: 1 }).textContent(), "Report a problem");
    await page.getByRole("radio", { name: /Request reprocessing/ }).check();
    await page.getByRole("textbox").fill("Keep my unfinished explanation.");
    await focusRefresh(page);
    assert.equal(await page.getByRole("radio", { name: /Request reprocessing/ }).isChecked(), true);
    assert.equal(await page.getByRole("textbox").inputValue(), "Keep my unfinished explanation.");
    // A new cut going live does not throw the draft away either.
    await page.evaluate(`window.fixtureState.activeProcessingVersionId=${JSON.stringify(newVersion)}`);
    await focusRefresh(page);
    assert.equal(await page.getByRole("textbox").inputValue(), "Keep my unfinished explanation.");
  });
});

test("ready match Tools requests a server refresh only for published or restored active IDs", { skip: !enabled }, async () => {
  await harness(async page => {
    await focusRefresh(page);
    assert.equal(await page.evaluate("window.refreshes"), 0);
    // The row reads Report a problem, with nothing on its right while no
    // request is open (post-rollout audit N).
    assert.equal((await page.locator("#link").textContent())?.trim(), "Report a problem");
    for (const [version, count] of [[newVersion, 1], [oldVersion, 2]] as const) {
      await page.evaluate(`window.fixtureState.activeProcessingVersionId=${JSON.stringify(version)}`);
      await focusRefresh(page);
      await page.waitForFunction(`window.refreshes === ${count}`);
      await focusRefresh(page);
      assert.equal(await page.evaluate("window.refreshes"), count);
    }
  });
});
