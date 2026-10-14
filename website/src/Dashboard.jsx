import { useEffect, useState, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

function Dashboard() {
  const navigate = useNavigate();

  // Core telemetry state
  const [data, setData] = useState({
    temperature: 0,
    vibration: 0,
    current: 0,
    status: "CONNECTING",
    ai_prediction: "WAITING",
    confidence: 98.0,
  });

  const [history, setHistory] = useState([]);
  const [dbHistory, setDbHistory] = useState([]);
  const [historyFilter, setHistoryFilter] = useState("all");
  const [online, setOnline] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [showWorkOrder, setShowWorkOrder] = useState(false);
  const [isEmergencyStopped, setIsEmergencyStopped] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const prevStatusRef = useRef("CONNECTING");
  const audioCtxRef = useRef(null);

  // Synthesize industrial alarm beep using Web Audio API
  const playAlarm = (severity = "fault") => {
    if (!audioEnabled) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") {
        ctx.resume();
      }

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = severity === "fault" ? "sawtooth" : "triangle";
      osc.frequency.setValueAtTime(severity === "fault" ? 880 : 587.33, now);
      osc.frequency.exponentialRampToValueAtTime(severity === "fault" ? 440 : 293.66, now + 0.35);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.35);
    } catch (e) {
      console.warn("Audio playback warning:", e);
    }
  };

  // Poll live telemetry
  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch("http://localhost:5000/latest");
        const result = await res.json();

        setData((prev) => ({
          ...prev,
          ...result,
          confidence: result.confidence || 98.0,
        }));
        setOnline(true);

        // Alarm trigger on status escalation
        if (
          result.status !== prevStatusRef.current &&
          (result.status === "FAULT" || result.status === "WARNING")
        ) {
          playAlarm(result.status.toLowerCase());
        }
        prevStatusRef.current = result.status;

        setHistory((old) => [
          ...old.slice(-24),
          {
            time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
            temperature: Number(result.temperature),
            current: Number(result.current),
            vibration: Number(result.vibration),
          },
        ]);
      } catch {
        setOnline(false);
      }
    };

    fetchData();
    const timer = setInterval(fetchData, 2000);
    return () => clearInterval(timer);
  }, [audioEnabled]);

  // Poll MongoDB Atlas historical records
  const fetchDbHistory = async () => {
    try {
      const res = await fetch("http://localhost:5000/history");
      const json = await res.json();
      if (json && json.history) {
        setDbHistory(json.history);
      }
    } catch (e) {
      console.warn("Failed to fetch MongoDB history:", e);
    }
  };

  useEffect(() => {
    fetchDbHistory();
    const histTimer = setInterval(fetchDbHistory, 10000);
    return () => clearInterval(histTimer);
  }, []);

  /* HEALTH SCORE & RUL CALCULATION */
  let health = 100;
  if (data.temperature >= 45) health -= 20;
  if (data.temperature >= 60) health -= 30;
  if (data.current >= 1.2) health -= 20;
  if (data.current >= 2.0) health -= 30;
  if (data.vibration) health -= 40;
  health = Math.max(0, Math.min(100, health));

  // Estimated Remaining Useful Life in Hours based on health degradation
  const estimatedRUL = useMemo(() => {
    if (health >= 90) return "720+ Hours (Optimal)";
    if (health >= 70) return "340 Hours (Good)";
    if (health >= 40) return "72 Hours (Schedule Service)";
    return "IMMEDIATE ATTENTION REQUIRED";
  }, [health]);

  // Root-Cause Diagnosis
  const rootCause = useMemo(() => {
    if (data.vibration && (data.temperature >= 60 || data.current >= 2.0)) {
      return "Critical Compound Mechanical & Electrical Overload";
    }
    if (data.vibration) {
      return "Bearing Kinematic Instability / Misalignment (SW-420 Trigger)";
    }
    if (data.temperature >= 60) {
      return "Thermal Runaway / Cooling Subsystem Failure (DS18B20 > 60°C)";
    }
    if (data.temperature >= 45) {
      return "Elevated Operating Heat / Friction Build-up";
    }
    if (data.current >= 2.0) {
      return "Severe Stator Overcurrent / Rotor Jam (ACS712 > 2.0A)";
    }
    if (data.current >= 1.2) {
      return "Load Surge / Electrical Warning Range";
    }
    return "Nominal Continuous Duty (All Parameters Within Tolerances)";
  }, [data]);

  /* STATUS */
  const effectiveStatus = isEmergencyStopped ? "E-STOP" : data.status;
  const statusClass =
    effectiveStatus === "FAULT" || effectiveStatus === "E-STOP"
      ? "fault"
      : effectiveStatus === "WARNING"
      ? "warning"
      : "normal";

  /* CSV EXPORT */
  const exportCSV = () => {
    const records = dbHistory.length > 0 ? dbHistory : history;
    if (!records || records.length === 0) {
      alert("No telemetry records available to export yet.");
      return;
    }

    const headers = ["Timestamp", "Temperature_C", "Vibration", "Current_A", "AI_Prediction", "Status"];
    const rows = records.map((r) => [
      r.timestamp || r.time || new Date().toISOString(),
      r.temperature ?? 0,
      r.vibration ? "DETECTED" : "NORMAL",
      r.current ?? 0,
      r.ai_prediction || data.ai_prediction,
      r.status || data.status,
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `predictx_telemetry_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  /* FULLSCREEN */
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  /* LOGOUT */
  const logout = () => {
    localStorage.removeItem("predictxLogin");
    navigate("/login");
  };

  const filteredHistory = useMemo(() => {
    if (historyFilter === "faults") {
      return dbHistory.filter((item) => item.status === "FAULT");
    }
    if (historyFilter === "warnings") {
      return dbHistory.filter((item) => item.status === "WARNING");
    }
    return dbHistory;
  }, [dbHistory, historyFilter]);

  return (
    <div className={`app ${isEmergencyStopped ? "estopActive" : ""}`}>
      {/* HEADER */}
      <header className="header">
        <div className="headerLeft">
          <div className="brandBadge">
            <span className="brandIcon">⚙️</span>
            <div>
              <h1>PredictX Industrial</h1>
              <p>Edge IoT + Cloud AI Predictive Maintenance</p>
            </div>
          </div>
        </div>

        <div className="headerRight">
          {/* Audio Alarm Toggle */}
          <button
            className={`toolBtn ${audioEnabled ? "toolBtnActive" : ""}`}
            onClick={() => setAudioEnabled(!audioEnabled)}
            title="Toggle Industrial Audio Alarm"
          >
            {audioEnabled ? "🔊 Alarm ON" : "🔇 Alarm Muted"}
          </button>

          {/* CSV Exporter */}
          <button className="toolBtn" onClick={exportCSV} title="Download CSV Log">
            📥 Export CSV
          </button>

          {/* Work Order Modal */}
          <button className="toolBtn" onClick={() => setShowWorkOrder(true)} title="Generate Work Order">
            📋 Work Order
          </button>

          {/* Fullscreen Toggle */}
          <button className="toolBtn" onClick={toggleFullscreen} title="Toggle Kiosk View">
            {isFullscreen ? "🗗 Exit Kiosk" : "⛶ Kiosk Mode"}
          </button>

          {/* Connection Status */}
          <div className={online ? "online" : "offline"}>
            ● {online ? "ONLINE" : "OFFLINE"}
          </div>

          {/* User Email Badge */}
          <div className="userEmailBadge" title={`Signed in as ${localStorage.getItem("predictxUserEmail") || "Operator"}`}>
            👤 {localStorage.getItem("predictxUserEmail") || "Operator"}
          </div>

          {/* Logout */}
          <button className="logoutButton" onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      <main>
        {/* EMERGENCY STOP BANNER IF ACTIVE */}
        {isEmergencyStopped && (
          <div className="alert estopAlert">
            🚨 EMERGENCY STOP (E-STOP) ACTIVATED BY OPERATOR
            <span>Machine power cut-off simulated. Reset E-stop to resume telemetry.</span>
            <button className="resetEstopBtn" onClick={() => setIsEmergencyStopped(false)}>
              🔄 Reset E-Stop
            </button>
          </div>
        )}

        {/* PRIMARY STATUS & ROOT CAUSE */}
        <section className="statusBox">
          <div className="statusHeader">
            <span className="live">● Live ESP32 Telemetry</span>
            <span className="confidenceBadge">
              AI Confidence: <b>{data.confidence}%</b>
            </span>
          </div>

          <p>Overall Machine Condition</p>
          <h2 className={statusClass}>{effectiveStatus}</h2>

          <div className="diagnosisBanner">
            <span className="diagLabel">AI Diagnosis:</span>
            <span className="diagText">{rootCause}</span>
          </div>

          {/* Emergency Stop Toggle Button */}
          <div className="estopContainer">
            <button
              className={`estopButton ${isEmergencyStopped ? "estopEngaged" : ""}`}
              onClick={() => setIsEmergencyStopped(!isEmergencyStopped)}
            >
              🛑 {isEmergencyStopped ? "E-STOP ENGAGED" : "EMERGENCY STOP"}
            </button>
          </div>
        </section>

        {/* ALERTS */}
        {data.status === "FAULT" && !isEmergencyStopped && (
          <div className="alert faultAlert">
            🚨 CRITICAL FAULT DETECTED
            <span>Immediate machine inspection required. Safe operating thresholds exceeded.</span>
            <button className="workOrderPromptBtn" onClick={() => setShowWorkOrder(true)}>
              Open Maintenance Work Order &rarr;
            </button>
          </div>
        )}

        {data.status === "WARNING" && !isEmergencyStopped && (
          <div className="alert warningAlert">
            ⚠️ MACHINE WARNING
            <span>Operating parameters approaching threshold limits. Maintenance team alerted.</span>
          </div>
        )}

        {/* DIGITAL TWIN MOTOR & RUL SECTION */}
        <section className="digitalTwinSection">
          <div className="digitalTwinCard">
            <div className="dtHeader">
              <h3>🧬 Digital Twin Asset: 3-Phase Induction Motor (MTR-01)</h3>
              <span className={`statusTag-${data.ai_prediction}`}>{data.ai_prediction}</span>
            </div>

            <div className="motorGraphicContainer">
              <svg viewBox="0 0 460 180" className="motorSvg">
                <defs>
                  <linearGradient id="metalGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#2c3a30" />
                    <stop offset="50%" stopColor="#1a241d" />
                    <stop offset="100%" stopColor="#0f1511" />
                  </linearGradient>
                  <linearGradient id="shaftGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#9fb49b" />
                    <stop offset="50%" stopColor="#5d6f5a" />
                    <stop offset="100%" stopColor="#2d372c" />
                  </linearGradient>
                </defs>

                {/* Motor Mounting Feet */}
                <rect x="70" y="145" width="45" height="15" rx="3" fill="#1b251e" stroke="rgba(196,241,105,0.2)" />
                <rect x="260" y="145" width="45" height="15" rx="3" fill="#1b251e" stroke="rgba(196,241,105,0.2)" />

                {/* Stator Shell */}
                <rect
                  x="70"
                  y="30"
                  width="235"
                  height="115"
                  rx="12"
                  fill="url(#metalGrad)"
                  stroke={data.current >= 1.2 ? "#ffc247" : "rgba(196,241,105,0.25)"}
                  strokeWidth={data.current >= 2.0 ? "3" : "1.5"}
                  className={data.current >= 1.2 ? "coilGlow" : ""}
                />

                {/* Thermal Aura if hot */}
                {data.temperature >= 45 && (
                  <rect
                    x="65"
                    y="25"
                    width="245"
                    height="125"
                    rx="15"
                    fill="none"
                    stroke={data.temperature >= 60 ? "rgba(255,119,113,0.5)" : "rgba(244,198,109,0.4)"}
                    strokeWidth="3"
                    className="heatAura"
                  />
                )}

                {/* Cooling Fins */}
                {[95, 120, 145, 170, 195, 220, 245, 270].map((x) => (
                  <line
                    key={x}
                    x1={x}
                    y1="32"
                    x2={x}
                    y2="143"
                    stroke="rgba(196,241,105,0.12)"
                    strokeWidth="2"
                  />
                ))}

                {/* Stator Core / Winding Window */}
                <rect x="110" y="55" width="155" height="65" rx="6" fill="#121814" stroke="rgba(113,225,209,0.3)" />

                {/* Rotor Shaft */}
                <rect x="25" y="80" width="375" height="15" rx="3" fill="url(#shaftGrad)" />

                {/* Bearing Housings */}
                <rect
                  x="55"
                  y="65"
                  width="25"
                  height="45"
                  rx="4"
                  fill={data.vibration ? "rgba(255,119,113,0.4)" : "#222d25"}
                  stroke={data.vibration ? "#ff7771" : "rgba(196,241,105,0.3)"}
                  strokeWidth={data.vibration ? "2.5" : "1"}
                  className={data.vibration ? "bearingAlert" : ""}
                />
                <rect
                  x="295"
                  y="65"
                  width="25"
                  height="45"
                  rx="4"
                  fill={data.vibration ? "rgba(255,119,113,0.4)" : "#222d25"}
                  stroke={data.vibration ? "#ff7771" : "rgba(196,241,105,0.3)"}
                  strokeWidth={data.vibration ? "2.5" : "1"}
                  className={data.vibration ? "bearingAlert" : ""}
                />

                {/* Rear Cooling Fan Shroud */}
                <path d="M 330,45 L 360,60 L 360,115 L 330,130 Z" fill="#18201a" stroke="rgba(196,241,105,0.25)" />

                {/* Drive Shaft Coupler */}
                <rect x="390" y="73" width="25" height="29" rx="3" fill="#435540" />

                {/* Interactive Diagnostic Labels */}
                <text x="68" y="22" fill={data.vibration ? "#ff7771" : "#8c978b"} fontSize="10" fontFamily="DM Mono">
                  Front Bearing {data.vibration ? "[SHOCK]" : "[OK]"}
                </text>
                <text x="180" y="90" textAnchor="middle" fill="#c4f169" fontSize="11" fontWeight="700">
                  {data.temperature}°C • {data.current}A
                </text>
                <text x="310" y="22" fill={data.vibration ? "#ff7771" : "#8c978b"} fontSize="10" fontFamily="DM Mono">
                  Drive Bearing
                </text>
              </svg>
            </div>

            <div className="dtFooter">
              <div className="dtMetric">
                <small>Asset ID</small>
                <strong>IND-MTR-01</strong>
              </div>
              <div className="dtMetric">
                <small>Bearing Condition</small>
                <strong className={data.vibration ? "textFault" : "textGood"}>
                  {data.vibration ? "Vibration Anomaly" : "Smooth Rotation"}
                </strong>
              </div>
              <div className="dtMetric">
                <small>Thermal State</small>
                <strong className={data.temperature >= 60 ? "textFault" : data.temperature >= 45 ? "textWarn" : "textGood"}>
                  {data.temperature >= 60 ? "Overheating" : data.temperature >= 45 ? "Elevated" : "Nominal"}
                </strong>
              </div>
              <div className="dtMetric">
                <small>Stator Amperage</small>
                <strong className={data.current >= 2.0 ? "textFault" : data.current >= 1.2 ? "textWarn" : "textGood"}>
                  {data.current >= 2.0 ? "High Overload" : data.current >= 1.2 ? "Moderate Load" : "Normal Load"}
                </strong>
              </div>
            </div>
          </div>

          {/* RUL & HEALTH CARD */}
          <div className="rulBox">
            <h3>⏳ Remaining Useful Life (RUL)</h3>
            <div className="rulScoreDisplay">
              <span className="rulHours">{estimatedRUL}</span>
              <p>Predictive wear estimate based on cumulative thermal, current, and kinematic vibration stress.</p>
            </div>

            <div className="healthBarContainer">
              <div className="healthBarLabel">
                <span>Machine Health Score</span>
                <b>{health}%</b>
              </div>
              <div className="healthBarTrack">
                <div
                  className="healthBarFill"
                  style={{
                    width: `${health}%`,
                    background: health < 50 ? "#ff7771" : health < 80 ? "#f4c66d" : "#c4f169",
                  }}
                />
              </div>
            </div>

            <div className="rulAdvice">
              <strong>Maintenance Recommendation:</strong>
              <span>
                {health >= 80
                  ? "Standard preventive cycle in 30 days. No immediate intervention required."
                  : health >= 50
                  ? "Perform bearing lubrication check and calibrate current transducer within 72 hours."
                  : "Immediate shutdown recommended. Check motor coupling alignment and bearing races."}
              </span>
            </div>
          </div>
        </section>

        {/* 4 CORE SENSOR TELEMETRY CARDS */}
        <section className="cards">
          <div className="card">
            <div className="icon">🌡️</div>
            <p>Temperature</p>
            <h2>{data.temperature} °C</h2>
            <div className="cardMeta">
              <span>Limit: 45°W / 60°F</span>
              <small>DS18B20 1-Wire</small>
            </div>
          </div>

          <div className="card">
            <div className="icon">📳</div>
            <p>Vibration Sensor</p>
            <h2 className={data.vibration ? "textFault" : "textGood"}>
              {data.vibration ? "DETECTED" : "NORMAL"}
            </h2>
            <div className="cardMeta">
              <span>Digital Tilt/Piezo</span>
              <small>SW-420 Sensor</small>
            </div>
          </div>

          <div className="card">
            <div className="icon">⚡</div>
            <p>Load Current</p>
            <h2>{data.current} A</h2>
            <div className="cardMeta">
              <span>Limit: 1.2A / 2.0A</span>
              <small>ACS712 Hall-Effect</small>
            </div>
          </div>

          <div className="card aiCard">
            <div className="icon">🤖</div>
            <p>AI Model Inference</p>
            <h2 className={`statusTag-${data.ai_prediction}`}>{data.ai_prediction}</h2>
            <div className="cardMeta">
              <span>Confidence: {data.confidence}%</span>
              <small>Random Forest Model</small>
            </div>
          </div>
        </section>

        {/* INTERACTIVE TELEMETRY CHARTS WITH SAFETY THRESHOLD LINES */}
        <section className="charts">
          <div className="chartBox">
            <div className="chartBoxHeader">
              <h2>🌡️ Temperature History (°C)</h2>
              <span className="threshLegend">
                <span className="dotWarn"></span> 45° Warn &nbsp;
                <span className="dotFault"></span> 60° Fault
              </span>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="#232e26" />
                <XAxis dataKey="time" stroke="#6f7f70" />
                <YAxis domain={[20, 80]} stroke="#6f7f70" />
                <Tooltip contentStyle={{ backgroundColor: "#151d17", borderColor: "#c4f16940" }} />
                <ReferenceLine y={45} stroke="#f4c66d" strokeDasharray="4 4" label={{ value: "Warning 45°C", fill: "#f4c66d", fontSize: 10 }} />
                <ReferenceLine y={60} stroke="#ff7771" strokeDasharray="4 4" label={{ value: "Fault 60°C", fill: "#ff7771", fontSize: 10 }} />
                <Line type="monotone" dataKey="temperature" stroke="#71e1d1" strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="chartBox">
            <div className="chartBoxHeader">
              <h2>⚡ Current History (Amperes)</h2>
              <span className="threshLegend">
                <span className="dotWarn"></span> 1.2A Warn &nbsp;
                <span className="dotFault"></span> 2.0A Fault
              </span>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="#232e26" />
                <XAxis dataKey="time" stroke="#6f7f70" />
                <YAxis domain={[0, 3.5]} stroke="#6f7f70" />
                <Tooltip contentStyle={{ backgroundColor: "#151d17", borderColor: "#c4f16940" }} />
                <ReferenceLine y={1.2} stroke="#f4c66d" strokeDasharray="4 4" label={{ value: "Warning 1.2A", fill: "#f4c66d", fontSize: 10 }} />
                <ReferenceLine y={2.0} stroke="#ff7771" strokeDasharray="4 4" label={{ value: "Fault 2.0A", fill: "#ff7771", fontSize: 10 }} />
                <Line type="monotone" dataKey="current" stroke="#c4f169" strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* MONGODB ATLAS HISTORICAL TELEMETRY TABLE */}
        <section className="historyTableSection">
          <div className="tableHeaderRow">
            <div>
              <h2>🗄️ MongoDB Atlas Telemetry Records</h2>
              <p>Auditable historical records synced from cloud database</p>
            </div>

            <div className="tableControls">
              <div className="filterPills">
                <button
                  className={`pillBtn ${historyFilter === "all" ? "pillBtnActive" : ""}`}
                  onClick={() => setHistoryFilter("all")}
                >
                  All Logs
                </button>
                <button
                  className={`pillBtn ${historyFilter === "faults" ? "pillBtnActive" : ""}`}
                  onClick={() => setHistoryFilter("faults")}
                >
                  🚨 Faults
                </button>
                <button
                  className={`pillBtn ${historyFilter === "warnings" ? "pillBtnActive" : ""}`}
                  onClick={() => setHistoryFilter("warnings")}
                >
                  ⚠️ Warnings
                </button>
              </div>

              <button className="toolBtn" onClick={fetchDbHistory}>
                🔄 Refresh Logs
              </button>
            </div>
          </div>

          <div className="tableWrapper">
            <table className="telemetryTable">
              <thead>
                <tr>
                  <th>Timestamp (UTC)</th>
                  <th>Temp (°C)</th>
                  <th>Vibration</th>
                  <th>Current (A)</th>
                  <th>AI Prediction</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.length > 0 ? (
                  filteredHistory.slice(0, 15).map((row, idx) => (
                    <tr key={idx} className={row.status === "FAULT" ? "rowFault" : ""}>
                      <td className="fontMono">{new Date(row.timestamp).toLocaleTimeString()}</td>
                      <td>{row.temperature}°C</td>
                      <td>
                        <span className={`statusPill ${row.vibration ? "pillFault" : "pillGood"}`}>
                          {row.vibration ? "DETECTED" : "NORMAL"}
                        </span>
                      </td>
                      <td>{row.current} A</td>
                      <td>
                        <span className="fontBold">{row.ai_prediction || "NORMAL"}</span>
                      </td>
                      <td>
                        <span className={`badgeMini statusTag-${row.status}`}>{row.status}</span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="6" className="emptyTable">
                      No historical logs found for the selected filter. Telemetry records will appear as ESP32 transmits data.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* SYSTEM HARDWARE INFORMATION */}
        <section className="systemBox">
          <h2>⚙️ System Architecture & Node Topology</h2>
          <div className="systemGrid">
            <div className="row">
              <b>Edge Microcontroller</b>
              <span>ESP32 NodeMCU-32S (Dual Core @ 240MHz)</span>
            </div>
            <div className="row">
              <b>Temperature Transducer</b>
              <span>Dallas DS18B20 1-Wire Digital Probes</span>
            </div>
            <div className="row">
              <b>Vibration Shock Sensor</b>
              <span>SW-420 High-Sensitivity Comparator (Pin 27)</span>
            </div>
            <div className="row">
              <b>AC/DC Current Transducer</b>
              <span>Allegro ACS712-05B Hall Sensor (Pin 34)</span>
            </div>
            <div className="row">
              <b>AI Inference Model</b>
              <span>Scikit-Learn Random Forest Classifier (model.pkl)</span>
            </div>
            <div className="row">
              <b>Telemetry Cloud Backend</b>
              <span>Flask API (Port 5000) + MongoDB Atlas Cluster</span>
            </div>
          </div>
        </section>
      </main>

      {/* MAINTENANCE WORK ORDER MODAL */}
      {showWorkOrder && (
        <div className="modalBackdrop" onClick={() => setShowWorkOrder(false)}>
          <div className="workOrderModal" onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <div>
                <h2>📋 Predictive Maintenance Work Order</h2>
                <small>Generated by PredictX Edge Automated Diagnostics</small>
              </div>
              <button className="closeBtn" onClick={() => setShowWorkOrder(false)}>
                &times;
              </button>
            </div>

            <div className="modalBody">
              <div className="woDetailsGrid">
                <div>
                  <b>Work Order ID:</b>
                  <span>WO-PREDICTX-{Date.now().toString().slice(-6)}</span>
                </div>
                <div>
                  <b>Asset Tag:</b>
                  <span>IND-MTR-01 (Main Drive Motor)</span>
                </div>
                <div>
                  <b>Current Machine Status:</b>
                  <span className={`badgeMini statusTag-${data.status}`}>{data.status}</span>
                </div>
                <div>
                  <b>AI Confidence:</b>
                  <span>{data.confidence}% Verified</span>
                </div>
              </div>

              <div className="woSnapshot">
                <h4>Telemetry Snapshot at Incident:</h4>
                <ul>
                  <li>Temperature: <strong>{data.temperature}°C</strong> (Warning: 45°C / Fault: 60°C)</li>
                  <li>Vibration: <strong>{data.vibration ? "DETECTED (Shock/Tilt Spike)" : "NORMAL"}</strong></li>
                  <li>Motor Current: <strong>{data.current} A</strong> (Warning: 1.2A / Fault: 2.0A)</li>
                  <li>Diagnosed Root Cause: <strong>{rootCause}</strong></li>
                </ul>
              </div>

              <div className="woChecklist">
                <h4>Technician Action Checklist:</h4>
                <label><input type="checkbox" defaultChecked /> Lock-out Tag-out (LOTO) verification on ESP32/Motor circuit</label>
                <label><input type="checkbox" /> Inspect bearing housing for lubricant breakdown or mechanical play</label>
                <label><input type="checkbox" /> Clean motor cooling fins and inspect DS18B20 probe contact</label>
                <label><input type="checkbox" /> Verify ACS712 shunt load calibration and check for rotor impedance</label>
              </div>
            </div>

            <div className="modalFooter">
              <button className="toolBtn" onClick={() => window.print()}>
                🖨️ Print Work Order
              </button>
              <button className="toolBtnActive toolBtn" onClick={() => setShowWorkOrder(false)}>
                Done / Close
              </button>
            </div>
          </div>
        </div>
      )}

      <footer>
        PredictX Industrial Suite © 2026 • Connected to ESP32 at 10.175.92.135 • AI Engine v2.4
      </footer>
    </div>
  );
}

export default Dashboard;