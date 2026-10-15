import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// D1's batch is a sequential SQL transaction, not Promise.all independent writes.
export function siteD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const migration of ['0001_game_users.sql','0002_security_state.sql','0007_reviews.sql','0008_site_auth.sql','0009_site_commerce.sql','0010_site_payment_metadata.sql','0025_site_student_members.sql','0026_site_member_identities.sql','0027_student_app_homework_sync.sql']) {
    sqlite.exec(readFileSync(new URL(`../../migrations/${migration}`,import.meta.url),'utf8'));
  }
  const db = { prepare(sql) {
    const statement=sqlite.prepare(sql);
    const bound=(args=[])=>{
      const execute=()=>{
        const results=statement.columns().length?statement.all(...args):[];
        const meta=results.length||statement.columns().length?{changes:sqlite.prepare('SELECT changes() AS count').get().count}:statement.run(...args);
        return {success:true,results,meta};
      };
      return {bind:(...params)=>bound(params), first:async()=>statement.get(...args)??null,
        all:async()=>({success:true,results:statement.all(...args)}),run:async()=>execute(),_execute:execute};
    };return bound();
  },batch:async statements=>{
    sqlite.exec('BEGIN IMMEDIATE');
    try{const results=statements.map(statement=>statement._execute());sqlite.exec('COMMIT');return results;}
    catch(error){sqlite.exec('ROLLBACK');throw error;}
  }};
  return {db,sqlite,close:()=>sqlite.close()};
}
