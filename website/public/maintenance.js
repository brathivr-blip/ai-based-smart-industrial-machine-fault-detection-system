const API_URL = "http://localhost:5000/latest";
const TASKS_STORAGE_KEY = "predictxMaintenanceTasks";
const POLL_INTERVAL_MS = 2000;

const elements = {
  clearButton: document.querySelector("#clear-button"),
  connection: document.querySelector("#connection"),
  connectionText: document.querySelector("#connection-text"),
  current: document.querySelector("#current-reading"),
  demoButton: document.querySelector("#demo-button"),
  emptyState: document.querySelector("#empty-state"),
  healthCaption: document.querySelector("#health-caption"),
  healthMeter: document.querySelector(".health-meter"),
  healthScore: document.querySelector("#health-score"),
  lastUpdated: document.querySelector("#last-updated"),
  modeBadge: document.querySelector("#mode-badge"),
  printButton: document.querySelector("#print-button"),
  progress: document.querySelector("#task-progress"),
  progressFill: document.querySelector("#progress-fill"),
  recommendationCount: document.querySelector("#recommendation-count"),
  recommendationList: document.querySelector("#recommendation-list"),
  recommendationSummary: document.querySelector("#recommendation-summary"),
  taskForm: document.querySelector("#task-form"),
  taskInput: document.querySelector("#task-input"),
  taskList: document.querySelector("#task-list"),
  temperature: document.querySelector("#temperature-reading"),
  vibration: document.querySelector("#vibration-reading"),
  storageError: document.querySelector("#storage-error"),
};

let currentReadings = null;
let usingSampleData = false;
let tasks = loadTasks();

function loadTasks() {
  try {
    const savedTasks = window.localStorage.getItem(TASKS_STORAGE_KEY);
    if (!savedTasks) return [];

    const parsedTasks = JSON.parse(savedTasks);
    if (!Array.isArray(parsedTasks)) {
      throw new Error("Saved maintenance tasks must be a list.");
    }

    return parsedTasks.filter(
      (task) =>
        task &&
        typeof task.id === "string" &&
        typeof task.text === "string" &&
        typeof task.done === "boolean" &&
        typeof task.source === "string",
    );
  } catch {
    return [];
  }
}

function saveTasks() {
  try {
    window.localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
    elements.storageError.hidden = true;
  } catch {
    elements.storageError.hidden = false;
  }
}

function makeTask(text, source = "custom") {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    done: false,
    source,
  };
}

function formatReading(value, digits = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : null;
}

function getRisk(readings) {
  const temperature = Number(readings.temperature);
  const current = Number(readings.current);
  const vibration = Boolean(Number(readings.vibration));
  let health = 100;

  if (temperature >= 45) health -= 20;
  if (temperature >= 60) health -= 30;
  if (current >= 1.2) health -= 20;
  if (current >= 2) health -= 30;
  if (vibration) health -= 40;

  health = Math.max(0, Math.min(100, health));
  return { health, temperature, current, vibration };
}

function getRecommendations(readings) {
  const { temperature, current, vibration } = getRisk(readings);
  const recommendations = [];

  if (temperature >= 60) {
    recommendations.push({
      title: "Inspect cooling and temperature",
      detail: `Temperature is ${temperature.toFixed(1)} °C. Check airflow, cooling, and sensor mounting before continued operation.`,
      priority: "URGENT",
      level: "critical",
    });
  } else if (temperature >= 45) {
    recommendations.push({
      title: "Review operating temperature",
      detail: `Temperature is ${temperature.toFixed(1)} °C. Check ventilation and compare against the machine's normal range.`,
      priority: "CHECK SOON",
      level: "caution",
    });
  }

  if (current >= 2) {
    recommendations.push({
      title: "Inspect electrical load",
      detail: `Current is ${current.toFixed(2)} A. Check for overload, loose wiring, or unusual motor resistance.`,
      priority: "URGENT",
      level: "critical",
    });
  } else if (current >= 1.2) {
    recommendations.push({
      title: "Check motor current",
      detail: `Current is ${current.toFixed(2)} A. Look for load changes and compare with the expected operating current.`,
      priority: "CHECK SOON",
      level: "caution",
    });
  }

  if (vibration) {
    recommendations.push({
      title: "Investigate machine vibration",
      detail: "Vibration is detected. Inspect mounting bolts, balance, alignment, and nearby moving parts.",
      priority: "CHECK SOON",
      level: "caution",
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      title: "Complete a routine visual inspection",
      detail: "Readings are within the planner's watch ranges. Check guards, fasteners, and the surrounding work area.",
      priority: "ROUTINE",
      level: "good",
    });
    recommendations.push({
      title: "Keep the next service date current",
      detail: "Record the last inspection and use the equipment manufacturer's service interval.",
      priority: "ROUTINE",
      level: "good",
    });
  }

  return recommendations;
}

function setConnection(mode) {
  const labels = {
    online: "LIVE DATA",
    offline: "BACKEND OFFLINE",
    demo: "SAMPLE DATA",
  };
  elements.connection.classList.toggle("is-online", mode === "online");
  elements.connection.classList.toggle("is-demo", mode === "demo");
  elements.connection.classList.toggle("is-offline", mode === "offline");
  elements.connectionText.textContent = labels[mode];
}

function updateHealth(readings) {
  const { health } = getRisk(readings);
  elements.healthScore.innerHTML = `${health}<small>%</small>`;
  elements.healthMeter.classList.toggle("is-caution", health < 80 && health >= 50);
  elements.healthMeter.classList.toggle("is-critical", health < 50);
  elements.healthCaption.textContent =
    health >= 80
      ? "Readings are within the planner's watch ranges."
      : health >= 50
        ? "One or more readings need a closer look."
        : "Prioritize inspection before normal operation.";
}

function renderRecommendations(readings) {
  const recommendations = getRecommendations(readings);
  elements.recommendationCount.textContent = String(recommendations.length);
  elements.recommendationSummary.textContent =
    recommendations.some((item) => item.level === "critical")
      ? "Urgent checks are listed first. Add them to your plan to track the follow-up."
      : recommendations.some((item) => item.level === "caution")
        ? "Some readings are outside the planner's usual watch ranges."
        : "No watch-range thresholds are currently exceeded. Keep up routine checks.";

  elements.recommendationList.replaceChildren();
  recommendations.forEach((recommendation) => {
    const card = document.createElement("article");
    card.className = `recommendation is-${recommendation.level}`;

    const icon = document.createElement("span");
    icon.className = "rec-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = recommendation.level === "critical" ? "!" : recommendation.level === "caution" ? "◈" : "✓";

    const copy = document.createElement("div");
    copy.className = "rec-copy";
    const title = document.createElement("strong");
    title.textContent = recommendation.title;
    const detail = document.createElement("span");
    detail.textContent = recommendation.detail;
    copy.append(title, detail);

    const priority = document.createElement("span");
    priority.className = `rec-priority is-${recommendation.level}`;
    priority.textContent = recommendation.priority;

    const addButton = document.createElement("button");
    addButton.className = "rec-add";
    addButton.type = "button";
    addButton.setAttribute("aria-label", `Add task: ${recommendation.title}`);
    addButton.textContent = "+";
    addButton.addEventListener("click", () => addTask(recommendation.title, "smart"));

    card.append(icon, copy, priority, addButton);
    elements.recommendationList.append(card);
  });
}

function renderTasks() {
  elements.taskList.replaceChildren();
  elements.emptyState.hidden = tasks.length > 0;

  tasks.forEach((task) => {
    const item = document.createElement("li");
    item.className = `task-item${task.done ? " is-done" : ""}`;

    const check = document.createElement("button");
    check.className = "task-check";
    check.type = "button";
    check.setAttribute("aria-pressed", String(task.done));
    check.setAttribute("aria-label", `${task.done ? "Mark incomplete" : "Complete"}: ${task.text}`);
    check.textContent = task.done ? "✓" : "";
    check.addEventListener("click", () => {
      tasks = tasks.map((entry) => (entry.id === task.id ? { ...entry, done: !entry.done } : entry));
      saveTasks();
      renderTasks();
    });

    const text = document.createElement("span");
    text.className = "task-text";
    text.textContent = task.text;

    const tag = document.createElement("span");
    tag.className = `task-tag${task.source === "custom" ? " is-custom" : ""}`;
    tag.textContent = task.source === "smart" ? "SMART CHECK" : "CUSTOM";

    const remove = document.createElement("button");
    remove.className = "task-remove";
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove task: ${task.text}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      tasks = tasks.filter((entry) => entry.id !== task.id);
      saveTasks();
      renderTasks();
    });

    item.append(check, text, tag, remove);
    elements.taskList.append(item);
  });

  const completedCount = tasks.filter((task) => task.done).length;
  const progress = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;
  elements.progress.textContent = `${completedCount} of ${tasks.length} complete`;
  elements.progressFill.style.width = `${progress}%`;
}

function addTask(text, source = "custom") {
  const normalizedText = text.trim();
  if (!normalizedText) return;

  const duplicateExists = tasks.some(
    (task) => task.text.toLowerCase() === normalizedText.toLowerCase() && !task.done,
  );
  if (duplicateExists) {
    elements.taskInput.setCustomValidity("This task is already in your plan.");
    elements.taskInput.reportValidity();
    window.setTimeout(() => elements.taskInput.setCustomValidity(""), 0);
    return;
  }

  tasks = [makeTask(normalizedText, source), ...tasks];
  saveTasks();
  renderTasks();
  if (source === "custom") {
    elements.taskInput.value = "";
    elements.taskInput.focus();
  }
}

function updateReadings(readings, mode) {
  currentReadings = readings;
  const temperature = formatReading(readings.temperature);
  const current = formatReading(readings.current, 2);
  const vibration = Number(readings.vibration);

  elements.temperature.innerHTML = temperature === null ? "--<small> °C</small>" : `${temperature}<small> °C</small>`;
  elements.current.innerHTML = current === null ? "--<small> A</small>" : `${current}<small> A</small>`;
  elements.vibration.textContent = Number.isFinite(vibration) ? (vibration ? "DETECTED" : "NORMAL") : "--";

  const { health } = getRisk(readings);
  const status = typeof readings.status === "string" ? readings.status.toUpperCase() : "";
  const badgeText = status === "FAULT" || health < 50 ? "INSPECT" : status === "WARNING" || health < 80 ? "WATCH" : "NORMAL";
  elements.modeBadge.textContent = badgeText;
  elements.modeBadge.classList.toggle("is-critical", badgeText === "INSPECT");
  elements.modeBadge.classList.toggle("is-caution", badgeText === "WATCH");
  elements.modeBadge.classList.toggle("is-good", badgeText === "NORMAL");

  updateHealth(readings);
  renderRecommendations(readings);
  setConnection(mode);
  elements.lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

async function fetchLatest() {
  if (usingSampleData) return;

  try {
    const response = await fetch(API_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Sensor service returned HTTP ${response.status}.`);
    }

    const readings = await response.json();
    const hasSensorValues =
      readings &&
      Number.isFinite(Number(readings.temperature)) &&
      Number.isFinite(Number(readings.current)) &&
      Number.isFinite(Number(readings.vibration));
    if (!hasSensorValues) {
      throw new Error("Sensor service returned incomplete readings.");
    }

    updateReadings(readings, "online");
  } catch {
    setConnection("offline");
    elements.modeBadge.textContent = currentReadings ? "LAST READING" : "AWAITING DATA";
    elements.modeBadge.classList.remove("is-critical", "is-caution", "is-good");
    elements.lastUpdated.textContent = currentReadings
      ? "Can't reach the sensor service. Showing the last available reading."
      : "Sensor service is unavailable. Try sample data or start the local backend.";
  }
}

elements.taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addTask(elements.taskInput.value);
});

elements.clearButton.addEventListener("click", () => {
  tasks = tasks.filter((task) => !task.done);
  saveTasks();
  renderTasks();
});

elements.printButton.addEventListener("click", () => window.print());

elements.demoButton.addEventListener("click", () => {
  usingSampleData = !usingSampleData;
  elements.demoButton.textContent = usingSampleData ? "Resume live data" : "Try sample data";

  if (usingSampleData) {
    updateReadings(
      {
        temperature: 52.4,
        vibration: 1,
        current: 1.35,
        status: "WARNING",
      },
      "demo",
    );
  } else {
    setConnection("offline");
    void fetchLatest();
  }
});

renderTasks();
void fetchLatest();
window.setInterval(() => void fetchLatest(), POLL_INTERVAL_MS);
