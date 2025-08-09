// main.js — clickable-lesson prototype (single-file logic)
import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js";

const outputEl = document.getElementById("output");
const traceEl = document.getElementById("trace");
const astEl = document.getElementById("ast");
const codeEl = document.getElementById("code");
const runBtn = document.getElementById("run-btn");
const stepBtn = document.getElementById("step-btn");
const testBtn = document.getElementById("test-btn");
const xpEl = document.getElementById("xp");
const levelEl = document.getElementById("level");
const lessonsListEl = document.getElementById("lessons-list");
const lessonTitleEl = document.getElementById("lesson-title");
const lessonGoalEl = document.getElementById("lesson-goal");
const hintBtn = document.getElementById("hint-btn");

let pyodide = null;
let lessons = [];
let currentLesson = null;
let failCounts = {};
let state = { xp: 0, level: 1, completed: {} };

const STORE_KEY = "pygamelearn_v1";

// --- persistence helpers
function loadState(){
  try{
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    state = {...state, ...s};
    if(!state.xp) state.xp = 0;
    if(!state.level) state.level = 1;
    if(!state.completed) state.completed = {};
  }catch(e){}
  updateUserbar();
}
function saveState(){
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}
function addXP(n){
  state.xp = (state.xp||0) + n;
  state.level = Math.floor(state.xp / 50) + 1;
  updateUserbar();
  saveState();
}
function updateUserbar(){
  xpEl.textContent = "XP: " + (state.xp || 0);
  levelEl.textContent = "Level: " + (state.level || 1);
}

// --- init
async function init(){
  outputEl.textContent = "Loading lessons and Pyodide...";
  loadState();
  lessons = await fetch("./lessons.json").then(r=>r.json());
  pyodide = await loadPyodide();
  outputEl.textContent = "Ready. Select a lesson.";
  buildLessonList();
  selectLesson(0);
}
init();

// --- UI: lesson list
function buildLessonList(){
  lessonsListEl.innerHTML = "";
  lessons.forEach((l, idx)=>{
    const li = document.createElement("li");
    li.textContent = l.title;
    li.dataset.idx = idx;
    if(state.completed[l.id]) li.classList.add("completed");
    li.onclick = ()=> selectLesson(idx);
    lessonsListEl.appendChild(li);
  });
}

function selectLesson(idx){
  const l = lessons[idx];
  currentLesson = l;
  codeEl.value = l.starter || "";
  lessonTitleEl.textContent = l.title;
  lessonGoalEl.textContent = l.goal || "";
  failCounts[l.id] = failCounts[l.id] || 0;
  highlightSelectedLesson();
  clearUI();
}
function highlightSelectedLesson(){
  Array.from(lessonsListEl.children).forEach(li=>{
    li.classList.toggle("active", lessons[li.dataset.idx].id === currentLesson.id);
  });
}

// --- Pyodide runner & tracer
async function runCodeTrap(src){
  const pythonRunner = `
import sys, json, ast
_src = ${JSON.stringify(src)}
# AST
try:
  ast_tree = ast.parse(_src)
  ast_json = ast.dump(ast_tree, include_attributes=False, indent=2)
except Exception as e:
  ast_json = "AST Error: " + str(e)

_trace = []
def tracer(frame, event, arg):
  if event == "line":
    lineno = frame.f_lineno
    locals_copy = {k: repr(v) for k,v in frame.f_locals.items()}
    _trace.append({"line": lineno, "locals": locals_copy})
  return tracer

from io import StringIO
_out = StringIO()
_old = sys.stdout
sys.stdout = _out
err = None
try:
  sys.settrace(tracer)
  exec(compile(_src, "<usercode>", "exec"), {})
  sys.settrace(None)
except Exception as e:
  sys.settrace(None)
  err = str(e)
sys.stdout = _old
_output_text = _out.getvalue()
print(json.dumps({"ast": ast_json, "trace": _trace, "output": _output_text, "error": err}))
`;
  try{
    const res = await pyodide.runPythonAsync(pythonRunner);
    return JSON.parse(res);
  }catch(err){
    return {error: String(err)};
  }
}

function clearUI(){
  outputEl.textContent = "";
  traceEl.innerHTML = "";
  astEl.textContent = "";
}
function renderResult(parsed){
  if(parsed.error){
    outputEl.textContent = "Error: " + parsed.error;
    return;
  }
  outputEl.textContent = parsed.output || "";
  traceEl.innerHTML = "";
  (parsed.trace || []).forEach(t=>{
    const div = document.createElement("div");
    div.textContent = `line ${t.line} — ${Object.keys(t.locals).map(k=>k+"="+t.locals[k]).join(", ")}`;
    traceEl.appendChild(div);
  });
  astEl.textContent = parsed.ast || "";
}

// --- controls
runBtn.onclick = async ()=>{
  if(!currentLesson) return;
  runBtn.disabled = true;
  outputEl.textContent = "Running...";
  const parsed = await runCodeTrap(codeEl.value);
  renderResult(parsed);
  runBtn.disabled = false;
  addXP(5);
  emitEvent('codeRun', {lesson: currentLesson.id, ok: !parsed.error});
};

stepBtn.onclick = async ()=>{
  if(!currentLesson) return;
  stepBtn.disabled = true;
  outputEl.textContent = "Preparing step trace...";
  const parsed = await runCodeTrap(codeEl.value);
  if(parsed.error){ renderResult(parsed); stepBtn.disabled=false; return; }
  traceEl.innerHTML = "";
  const arr = parsed.trace || [];
  if(arr.length===0){ stepBtn.disabled=false; return; }
  let i = 0;
  const timer = setInterval(()=>{
    traceEl.innerHTML = "";
    const t = arr[i];
    const div = document.createElement("div");
    div.textContent = `line ${t.line} — ${JSON.stringify(t.locals)}`;
    traceEl.appendChild(div);
    i++;
    if(i>=arr.length){ clearInterval(timer); stepBtn.disabled=false; addXP(10); emitEvent('stepComplete', {lesson: currentLesson.id}); }
  }, 500);
};

testBtn.onclick = async ()=>{
  if(!currentLesson) return;
  testBtn.disabled = true;
  outputEl.textContent = "Running tests...";
  const userSrc = codeEl.value;
  const lesson = currentLesson;
  const harness = `
import json, sys
_user = ${JSON.stringify(userSrc)}
_check_src = ${JSON.stringify(lesson.tests)}
from io import StringIO
sout = StringIO()
old = sys.stdout
sys.stdout = sout
try:
    exec(compile(_user, "<user>", "exec"), {})
except Exception as e:
    sys.stdout = old
    print(json.dumps({"passed": False, "error": str(e), "output": sout.getvalue()}))
else:
    sys.stdout = old
    ns = {}
    try:
        exec(compile(_check_src, "<check>", "exec"), ns)
        passed = ns.get("check")(sout.getvalue()) if 'check' in ns else False
        print(json.dumps({"passed": bool(passed), "error": None, "output": sout.getvalue()}))
    except Exception as e:
        print(json.dumps({"passed": False, "error": str(e), "output": sout.getvalue()}))
`;
  try{
    const res = await pyodide.runPythonAsync(harness);
    const parsed = JSON.parse(res);
    outputEl.textContent = parsed.output + "\n\nTests: " + (parsed.passed ? "PASS" : "FAIL") + (parsed.error ? ("\nError: "+parsed.error) : "");
    if(parsed.passed){
      addXP(lesson.xp_reward || 20);
      state.completed[lesson.id] = true;
      saveState();
      buildLessonList();
      emitEvent('taskPassed', {lesson: lesson.id});
    } else {
      failCounts[lesson.id] = (failCounts[lesson.id] || 0) + 1;
      const attempts = failCounts[lesson.id];
      if(lesson.hints && attempts % 2 === 0){
        const hid = Math.min(Math.floor(attempts/2)-1, lesson.hints.length-1);
        if(hid >= 0) alert("Hint: " + lesson.hints[hid]);
      }
      emitEvent('taskFailed', {lesson: lesson.id, attempts});
    }
  }catch(err){
    outputEl.textContent = "Test harness failed: " + err;
  }
  testBtn.disabled = false;
};

hintBtn.onclick = ()=>{
  if(!currentLesson) return;
  const attempts = failCounts[currentLesson.id] || 0;
  const hintIndex = Math.min(Math.floor(attempts/2), (currentLesson.hints||[]).length - 1);
  if(currentLesson.hints && currentLesson.hints[hintIndex]){
    alert("Hint: " + currentLesson.hints[hintIndex]);
    failCounts[currentLesson.id] = attempts + 1;
  } else {
    alert("No more hints. Try running your code — you'll get more targeted hints after attempts.");
  }
};

// minimal event emitter
function emitEvent(name, data){ console.log("EV:", name, data); }