// Run the feedback tidy prompt over sample messages and print what it makes.
//   OPENAI_API_KEY=... node --experimental-strip-types scripts/feedback-tidy-check.mjs [model]
import { TIDY_MODEL, TIDY_SYSTEM_PROMPT, TIDY_RESPONSE_SCHEMA, tidyUserMessage, parseTidy } from "../src/lib/feedbackTidy.ts";

const model = process.argv[2] ?? TIDY_MODEL;
const SAMPLES = [
  "How about adding translations?",
  "When I'm editting/point counting:\n1) Can you add a progress bar so we can keep track of where we are in the original video? \n2) I deleted something that I want to undo, but I can't find the undo button.\n3) Is there a way to deal with or identify miscounted scores or serve turns?",
  "After processing the video, when I want to watch the original video, there are some slowed-down frames. Not sure if this is a glitch, a feature, or my own problem with wifi.",
  "It did not remove anything",
  "Very difficult to choose what side you are on",
  "on the website login it automatically logged you out every time you quit the tab and there's no option for a password so you always have to have it send you a code",
  "我的比赛上传了两个小时还没处理好，可以帮我看看吗？",
  "can the journal have a search bar. also the coach invite link should work in whatsapp preview",
  "can u make the heatmap show where i lose points not just serves. also dark mode is hard to read in sunlight",
];
for (const body of SAMPLES) {
  const t0 = Date.now();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model, store: false, reasoning_effort: process.env.EFFORT ?? "low", max_completion_tokens: 4000,
      messages: [{ role: "system", content: TIDY_SYSTEM_PROMPT }, { role: "user", content: tidyUserMessage(body, []) }],
      response_format: TIDY_RESPONSE_SCHEMA,
    }),
  });
  const data = await res.json();
  if (!res.ok) { console.log("ERR", JSON.stringify(data).slice(0, 300)); continue; }
  const tidy = parseTidy(JSON.parse(data.choices[0].message.content), []);
  console.log(`\n>>> ${body.slice(0, 70).replace(/\n/g, " ")}  [${Date.now() - t0}ms]`);
  console.log(JSON.stringify(tidy, null, 1));
}
