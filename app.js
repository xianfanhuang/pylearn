let pyodide = null;
let lessons = [];
let currentLesson = null;
let traceData = [];
let currentStep = 0;

async function initPyodide() {
    pyodide = await loadPyodide();
    console.log("Pyodide loaded");
}

async function loadLessons() {
    const res = await fetch("lessons.json");
    lessons = await res.json();
    const lessonList = document.getElementById("lessonList");
    lessonList.innerHTML = "";
    lessons.forEach(lesson => {
        const li = document.createElement("li");
        li.textContent = lesson.title;
        li.addEventListener("click", () => loadLesson(lesson.id));
        lessonList.appendChild(li);
    });
}

function loadLesson(id) {
    currentLesson = lessons.find(l => l.id === id);
    document.getElementById("lessonTitle").textContent = currentLesson.title;
    document.getElementById("lessonDescription").textContent = currentLesson.description;
    document.getElementById("codeEditor").value = currentLesson.starter_code;
    document.getElementById("output").textContent = "";
    document.getElementById("visualizerContainer").style.display = "none";
}

async function runCode() {
    const code = document.getElementById("codeEditor").value;
    try {
        const result = await pyodide.runPythonAsync(code);
        document.getElementById("output").textContent = result !== undefined ? result : "";
    } catch (err) {
        document.getElementById("output").textContent = err;
    }
}

async function checkCode() {
    if (!currentLesson) return alert("Select a lesson first!");
    let passed = true;
    let feedback = "";
    for (let test of currentLesson.tests) {
        try {
            let output = await pyodide.runPythonAsync(currentLesson.starter_code + "\n" + document.getElementById("codeEditor").value);
        } catch {
            output = "";
        }
        const result = await pyodide.runPythonAsync(document.getElementById("codeEditor").value);
        if (String(result).trim() !== test.expected_output.trim()) {
            passed = false;
            feedback += `Test failed. Expected "${test.expected_output}", got "${result}".\n`;
        }
    }
    if (passed) {
        feedback = "All tests passed! 🎉";
    }
    document.getElementById("output").textContent = feedback;
}

async function visualizeCode() {
    const code = document.getElementById("codeEditor").value;
    const tracerScript = `
import sys, json, builtins
from types import FrameType

trace_data = []
def tracefunc(frame: FrameType, event: str, arg):
    if event == 'line':
        trace_data.append({
            'line': frame.f_lineno,
            'locals': dict(frame.f_locals)
        })
    return tracefunc

sys.settrace(tracefunc)
` + code + `
sys.settrace(None)
json.dumps(trace_data)
`;
    try {
        const result = await pyodide.runPythonAsync(tracerScript);
        traceData = JSON.parse(result);
        currentStep = 0;
        showStep();
        document.getElementById("visualizerContainer").style.display = "block";
    } catch (err) {
        document.getElementById("output").textContent = err;
    }
}

function showStep() {
    if (!traceData.length) return;
    const step = traceData[currentStep];
    const codeLines = document.getElementById("codeEditor").value.split("\n");
    const codeView = codeLines.map((line, idx) => {
        if (idx + 1 === step.line) {
            return `<div class="highlight">${line}</div>`;
        }
        return `<div>${line}</div>`;
    }).join("");
    document.getElementById("codeView").innerHTML = codeView;
    document.getElementById("variablesView").innerHTML = `<pre>${JSON.stringify(step.locals, null, 2)}</pre>`;
}

document.getElementById("runCode").addEventListener("click", runCode);
document.getElementById("checkCode").addEventListener("click", checkCode);
document.getElementById("visualizeCode").addEventListener("click", visualizeCode);
document.getElementById("prevStep").addEventListener("click", () => {
    if (currentStep > 0) {
        currentStep--;
        showStep();
    }
});
document.getElementById("nextStep").addEventListener("click", () => {
    if (currentStep < traceData.length - 1) {
        currentStep++;
        showStep();
    }
});

initPyodide();
loadLessons();