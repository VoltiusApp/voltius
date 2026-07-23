// Minimal W3C WebDriver client for tauri-driver (localhost:4444), run INSIDE a
// tauri-headless container:  docker exec <container> node /app/wd.mjs <cmd> [args]
// Session id persists in /tmp/wd_sid so calls chain across `docker exec`s.
const BASE = 'http://localhost:4444';
const SIDF = '/tmp/wd_sid';
import { readFileSync, writeFileSync } from 'fs';
const sid = () => readFileSync(SIDF, 'utf8').trim();
async function j(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: {'Content-Type':'application/json'}, body: body?JSON.stringify(body):undefined });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = { raw: t }; }
  return { status: r.status, d };
}
const [cmd, ...a] = process.argv.slice(2);
async function findId(sel) {
  const r = await j('POST', `/session/${sid()}/element`, { using:'css selector', value: sel });
  const v = r.d && r.d.value; if (!v) throw new Error('not found: '+sel+' :: '+JSON.stringify(r.d).slice(0,200));
  return v[Object.keys(v)[0]];
}
async function execSync(script, args=[]) {
  const r = await j('POST', `/session/${sid()}/execute/sync`, { script, args });
  return r.d && ('value' in r.d ? r.d.value : r.d);
}
try {
  if (cmd === 'new') {
    // arg0 optional = VOLTIUS_KEYCHAIN_NS. NOTE: this env is IGNORED by tauri-driver
    // (kept for reference); set VOLTIUS_KEYCHAIN_NS at `docker run -e ...` instead.
    const env = {};
    if (a[0]) env.VOLTIUS_KEYCHAIN_NS = a[0];
    const r = await j('POST', '/session', { capabilities:{ alwaysMatch:{ 'tauri:options':{ application:'/app/target/debug/voltius', env } } } });
    const s = r.d && r.d.value && r.d.value.sessionId;
    if (!s) { console.log('FAIL '+JSON.stringify(r.d).slice(0,300)); process.exit(1); }
    writeFileSync(SIDF, s); await j('POST', `/session/${s}/timeouts`, { implicit: 6000 });
    console.log('SESSION '+s);
  } else if (cmd === 'shot') {                    // screenshots are usually BLACK (WebKitGTK) — prefer `eval`
    const r = await j('GET', `/session/${sid()}/screenshot`);
    writeFileSync('/app/screenshots/'+a[0]+'.png', r.d.value, 'base64');
    console.log('SHOT /app/screenshots/'+a[0]+'.png');
  } else if (cmd === 'click') {                   // click by CSS selector (synthetic event sequence)
    const out = await execSync(`
      var el=document.querySelector(arguments[0]); if(!el) return 'NOEL';
      el.scrollIntoView({block:'center',inline:'center'});
      var r=el.getBoundingClientRect(), cx=r.left+r.width/2, cy=r.top+r.height/2;
      ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(function(t){
        el.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,clientX:cx,clientY:cy,button:0}));
      }); return 'OK';`, [a[0]]);
    console.log('CLICK '+a[0]+' -> '+out);
  } else if (cmd === 'clicktext') {               // click the first visible element whose exact trimmed text == arg0
    const out = await execSync(`
      var t=arguments[0];
      var el=[].slice.call(document.querySelectorAll('button,div[class*=cursor],[role=menuitem],[role=button],a,li'))
        .find(function(e){return (e.innerText||'').trim()===t && e.getBoundingClientRect().width>0;});
      if(!el) return 'NOEL';
      var r=el.getBoundingClientRect(), cx=r.left+r.width/2, cy=r.top+r.height/2;
      ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(function(n){
        el.dispatchEvent(new MouseEvent(n,{bubbles:true,cancelable:true,clientX:cx,clientY:cy,button:0}));
      }); return 'OK';`, [a[0]]);
    console.log('CLICKTEXT '+JSON.stringify(a[0])+' -> '+out);
  } else if (cmd === 'setval') {                  // set a REACT-controlled input: arg0=selector arg1=value
    const out = await execSync(`
      var i=document.querySelector(arguments[0]); if(!i) return 'NOEL';
      var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      s.call(i, arguments[1]); i.dispatchEvent(new Event('input',{bubbles:true}));
      i.dispatchEvent(new Event('change',{bubbles:true})); return i.value;`, [a[0], a[1]]);
    console.log('SETVAL '+a[0]+' -> '+JSON.stringify(out));
  } else if (cmd === 'type') {                    // WebDriver keystrokes (leaves React state stale — prefer setval)
    const id = await findId(a[0]);
    if (a[2] === 'clear') await j('POST', `/session/${sid()}/element/${id}/clear`);
    const r = await j('POST', `/session/${sid()}/element/${id}/value`, { text: a[1] });
    console.log('TYPE '+a[0]+' status '+r.status);
  } else if (cmd === 'exists') {
    const r = await j('POST', `/session/${sid()}/element`, { using:'css selector', value: a[0] });
    console.log(r.d && r.d.value ? 'YES' : 'NO');
  } else if (cmd === 'text') {
    const out = await execSync(`var el=document.querySelector(arguments[0]);return el?el.innerText:'NOEL';`, [a[0]]);
    console.log(JSON.stringify(out).slice(0,600));
  } else if (cmd === 'eval') {                     // run arbitrary JS; MUST `return` a value. THE primary introspection tool.
    const out = await execSync(a[0]);
    console.log(JSON.stringify(out).slice(0,1500));
  } else if (cmd === 'esc') {                       // press Escape (close modals/menus)
    await execSync(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return 'esc';`);
    console.log('ESC');
  } else if (cmd === 'source') {
    const r = await j('GET', `/session/${sid()}/source`);
    console.log((r.d.value||'').slice(0, parseInt(a[0]||'2000')));
  } else { console.log('unknown cmd'); process.exit(1); }
} catch (e) { console.log('ERR '+e.message); process.exit(1); }
