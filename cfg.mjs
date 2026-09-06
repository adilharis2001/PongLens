import { execFileSync } from "node:child_process";
const kc = (s) => execFileSync("security",
  ["find-generic-password","-a","openclaw","-s",s,"-w"],{encoding:"utf8"}).trim();
const SR = kc("ponglens-service-role"), URL = kc("ponglens-supabase-url");
const h = { apikey: SR, Authorization: "Bearer " + SR };
const r = await fetch(`${URL}/rest/v1/app_config?key=in.(review_signin_email,review_signin_code,iap_enabled)&select=key,value`, { headers: h });
console.log(await r.text());
