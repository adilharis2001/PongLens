// Node 25 removed --loader; hooks now register from the main thread.
import { register } from "node:module";
import { pathToFileURL } from "node:url";
register("./resolver_hook.mjs", import.meta.url);
