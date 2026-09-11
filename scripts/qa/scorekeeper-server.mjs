// Local fixture server. Stop this before running npm run build: both use .next.
import http from 'node:http';
import next from 'next';

if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:3218' ||
   process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!=='local-fixture-only') {
  throw new Error('Use the synthetic Supabase environment documented in scorekeeper.md.');
}
const app=next({dev:true,hostname:'127.0.0.1',port:3217});
await app.prepare();
http.createServer(app.getRequestHandler()).listen(3217,'127.0.0.1',()=>{
  console.log('Synthetic scorekeeper fixture server: http://127.0.0.1:3217');
});
