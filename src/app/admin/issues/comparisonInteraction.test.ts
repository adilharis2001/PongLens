import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { chromium, type Page } from "playwright";

const enabled = process.env.MATCH_ISSUES_BROWSER_TEST === "1";
const require = createRequire(import.meta.url);
const root = process.cwd();
const detail = {
  issue: { id:"issue", match_id:"match", source_job_id:"job", reporter_id:"owner", owner_id:"owner", reporter_role:"owner", kind:"reprocess", status:"candidate_ready", refundable_minutes:11, created_at:"2026-09-07", updated_at:"2026-09-07", message:"Missing rally", player_note:"", internal_note:"", source_version_id:"old", replacement_version_id:"new" },
  match:{ id:"match", jobId:"job", opponentName:"Match", playedAt:"2026-09-07" }, events:[], sourceAvailable:true,
  versions:[{id:"old",status:"active",cut_path:"r2://media/old.mp4",created_at:"2026-09-05",release_id:"old-release",settings:{strictness:"normal",placement:true},totals:{points:83,retained_duration_s:521}},
    {id:"new",status:"ready",cut_path:"r2://media/new.mp4",created_at:"2026-09-07",release_id:"new-release",settings:{strictness:"tight",placement:true},totals:{points:91,retained_duration_s:544}}],
};
const upload = { match:{raw_available:true}, job:{id:"job"}, points:[], totals:{visible:83,deleted:0,scored:0,starred:0,src_duration_s:600,cut_duration_s:521} };

/** Bundle the real React components for a local browser harness. Only Next
 * navigation and the remote Supabase boundary are replaced; ClipPlayer,
 * hooks, reconciliation and the actual HTMLVideoElement are not mocked. */
function browserBundle() {
  const factories:Record<string,string> = {};
  const packageFile = (name:string,file:string) => path.join(path.dirname(require.resolve(name)),"cjs",file);
  const packages:Record<string,string> = {
    react:packageFile("react","react.production.js"),
    "react/jsx-runtime":packageFile("react","react-jsx-runtime.production.js"),
    "react-dom":packageFile("react-dom","react-dom.production.js"),
    "react-dom/client":packageFile("react-dom","react-dom-client.production.js"),
    scheduler:packageFile("scheduler","scheduler.production.js"),
  };
  const add = (id:string):string => {
    if(id in factories)return id;
    factories[id]="";
    let source:string;
    if(id==="next/link")source="module.exports={__esModule:true,default:'a'};";
    else if(id==="@/lib/supabase/client")source="exports.createClient=()=>({rpc:async(name)=>{if(name==='admin_match_issue_detail')return {data:structuredClone(window.fixtureDetail),error:null};window.uploadLoading=true;await new Promise(resolve=>window.releaseUpload=resolve);window.uploadLoading=false;return {data:structuredClone(window.fixtureUpload),error:null};}});";
    else if(id in packages)source=readFileSync(packages[id],"utf8");
    else source=ts.transpileModule(readFileSync(id,"utf8"),{fileName:id,compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
    const dependencies:Record<string,string>={};
    for(const match of source.matchAll(/require\(["']([^"']+)["']\)/g)) {
      const dependency=match[1];
      let resolved=dependency;
      if(dependency!=="@/lib/supabase/client" && (dependency.startsWith(".") || dependency.startsWith("@/"))) {
        const base=dependency.startsWith("@/")?path.join(root,"src",dependency.slice(2)):path.resolve(path.dirname(id),dependency);
        resolved=[base,base+".ts",base+".tsx"].find(file=>existsSync(file))!;
        if(!resolved)throw new Error("Cannot resolve "+dependency);
      }
      dependencies[dependency]=add(resolved);
    }
    factories[id]=`function(module,exports,load){const dependencies=${JSON.stringify(dependencies)};const require=id=>load(dependencies[id]);${source}\n}`;
    return id;
  };
  const entry=add(path.join(root,"src/app/admin/issues/MatchIssueDetail.tsx"));
  add("react-dom/client"); add("react");
  return `(()=>{const process={env:{NODE_ENV:'production'}};const factories={${Object.entries(factories).map(([id,code])=>`${JSON.stringify(id)}:${code}`).join(",")}};const cache={};const load=id=>{if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;factories[id](module,module.exports,load);return module.exports;};const React=load('react');const root=load('react-dom/client').createRoot(document.getElementById('root'));window.fixtureDetail=${JSON.stringify(detail)};window.fixtureUpload=${JSON.stringify(upload)};root.render(React.createElement(load(${JSON.stringify(entry)}).MatchIssueDetail,{initialDetail:window.fixtureDetail,upload:window.fixtureUpload,identity:null}));})();`;
}
async function sameVideo(page:Page) {
  return page.evaluate("document.querySelectorAll('video').length===1 && document.querySelector('video')===window.originalVideo");
}
async function harness(run:(page:Page,signs:string[])=>Promise<void>) {
  const fixtureDir=mkdtempSync(path.join(tmpdir(),"ponglens-comparison-"));
  let video:Buffer;
  try {
    const fixture=path.join(fixtureDir,"video.mp4");
    execFileSync("ffmpeg",["-v","error","-f","lavfi","-i","color=c=black:s=160x90:r=10","-t","5","-c:v","libx264","-pix_fmt","yuv420p","-movflags","+faststart",fixture]);
    video=readFileSync(fixture);
  } finally { rmSync(fixtureDir,{recursive:true}); }
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:393,height:660}});
  const signs:string[]=[];
  try {
    await page.route("https://ponglens.test/**",async route=>{
      if(route.request().url().includes("/api/admin/media-url")) {
        const input=route.request().postDataJSON(); const id=input.versionId ?? "original"; signs.push(id);
        await new Promise(resolve=>setTimeout(resolve,150));
        await route.fulfill({contentType:"application/json",body:JSON.stringify({url:`https://ponglens.test/media/${id}.mp4`})});
      } else if(route.request().url().includes("/media/")) await route.fulfill({contentType:"video/mp4",body:video});
      else await route.fulfill({contentType:"text/html",body:'<div id="root"></div>'});
    });
    await page.goto("https://ponglens.test/");
    await page.addScriptTag({content:browserBundle()});
    await page.waitForFunction("document.querySelector('video')?.readyState >= 1");
    await page.evaluate("window.originalVideo=document.querySelector('video')");
    await run(page,signs);
  } finally { await browser.close(); }
}
test("version switching preserves one mounted video while changing its source and reuses signed versions",{skip:!enabled},async()=>{
  await harness(async(page,signs)=>{
    await page.evaluate("window.originalVideo.muted=true;window.originalVideo.play()");
    const signing=page.waitForRequest("**/api/admin/media-url");
    await page.getByRole("button",{name:"New version",exact:true}).click(); await signing;
    assert.equal(await sameVideo(page),true,"the video must remain mounted while the new URL loads");
    assert.equal(await page.evaluate("window.originalVideo.paused"),true,"the previous source stops when another version is selected");
    await page.waitForFunction("document.querySelector('video')?.src.endsWith('/new.mp4')");
    assert.equal(await sameVideo(page),true,"the same element receives the new source");
    await page.getByRole("button",{name:"Current",exact:true}).click();
    await page.waitForFunction("document.querySelector('video')?.src.endsWith('/old.mp4')");
    assert.equal(await sameVideo(page),true); assert.deepEqual(signs,["old","new"]);
  });
});
test("unchanged canonical refresh preserves New version selection, playback and the existing signed URL",{skip:!enabled},async()=>{
  await harness(async(page,signs)=>{
    await page.getByRole("button",{name:"New version",exact:true}).click();
    await page.waitForFunction("document.querySelector('video')?.src.endsWith('/new.mp4') && document.querySelector('video').readyState>=1");
    await page.evaluate("window.originalVideo=document.querySelector('video');window.originalVideo.muted=true;window.originalVideo.play()");
    await page.waitForFunction("window.originalVideo.currentTime>=0.5 && !window.originalVideo.paused");
    const beforeRefresh=await page.evaluate<number>("window.originalVideo.currentTime");
    await page.getByRole("button",{name:"Refresh saved request",exact:true}).click();
    await page.waitForFunction("window.uploadLoading===true");
    assert.equal(await sameVideo(page),true,"diagnostics loading must not remount the comparison");
    assert.equal(await page.getByRole("button",{name:"New version",exact:true}).getAttribute("aria-pressed"),"true");
    await page.evaluate("window.releaseUpload()");
    await page.waitForFunction("window.uploadLoading===false");
    assert.equal(await sameVideo(page),true);
    assert.equal(await page.evaluate(time=>document.querySelector('video')!.currentTime>=time && !document.querySelector('video')!.paused,beforeRefresh),true,"unchanged refresh leaves playback running at its existing position");
    assert.deepEqual(signs,["old","new"]);
  });
});
