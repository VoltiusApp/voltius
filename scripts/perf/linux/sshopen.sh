#!/bin/bash
# quick-connect voltius@ssh-host-1:2222 and tag the SSH terminal [data-perf]
cd "$(dirname "$0")"
node wd.mjs eval 'window.dispatchEvent(new KeyboardEvent("keydown",{key:"k",code:"KeyK",ctrlKey:true,bubbles:true,cancelable:true})); return 1' >/dev/null; sleep 1
node wd.mjs setval 'input[placeholder^="Search hosts, keys"]' "ssh voltius@${1:-ssh-host-1} -p 2222" >/dev/null; sleep 1
node wd.mjs eval 'const e=[...document.querySelectorAll("*")].filter(e=>e.offsetParent&&e.children.length<6&&(e.innerText||"").startsWith("Connect to voltius@"))[0]; const t=e.closest("button")||e; ["pointerdown","mousedown","pointerup","mouseup","click"].forEach(n=>t.dispatchEvent(new MouseEvent(n,{bubbles:true,cancelable:true}))); return 1' >/dev/null; sleep 5
node wd.mjs setval 'input[placeholder="Password"]' 'voltius' >/dev/null
node wd.mjs eval 'const b=[...document.querySelectorAll("button")].find(b=>b.offsetParent&&b.innerText.trim()==="Connect"); b.click(); return 1' >/dev/null; sleep 8
node wd.mjs eval 'const ts=[...document.querySelectorAll(".xterm-helper-textarea")]; const v=ts.find(t=>!t.closest(".invisible")&&t.closest(".xterm").getBoundingClientRect().width>0); ts.forEach(t=>t.removeAttribute("data-perf")); if(v) v.setAttribute("data-perf","1"); return {n:ts.length, tagged:!!v}'
