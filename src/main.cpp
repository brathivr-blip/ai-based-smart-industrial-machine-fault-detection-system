#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// ================= WIFI =================
const char* ssid = "motoedge60fusion_2747";
const char* password = "password";

// Laptop IP running api.py
const char* AI_URL = "http://10.175.92.207:5000/predict";

WebServer server(80);

// ================= PINS =================
#define TEMP_PIN       4
#define VIBRATION_PIN  27
#define CURRENT_PIN    34

#define BLUE_LED       26
#define YELLOW_LED     25
#define RED_LED        33
#define BUZZER         32

// ================= OLED =================
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64

Adafruit_SSD1306 display(
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  &Wire,
  -1
);

// ================= TEMPERATURE =================
OneWire oneWire(TEMP_PIN);
DallasTemperature tempSensor(&oneWire);

// ================= VARIABLES =================
float temperature = 0;
float current = 0;
float zeroVoltage = 0;

int vibration = 0;

String status = "STARTING";
String aiPrediction = "WAITING";

// ================= ACS712 =================
const float ACS_SENSITIVITY = 0.100;
const float DIVIDER_FACTOR = 1.5;

// ================= THRESHOLD LIMITS =================

// Temperature
const float TEMP_WARNING = 45.0;
const float TEMP_FAULT   = 60.0;

// Current
const float CURRENT_WARNING = 1.20;
const float CURRENT_FAULT   = 2.00;

// Vibration
// HIGH = vibration detected = FAULT


// ================= CURRENT READING =================
float readCurrent() {

  long total = 0;

  for (int i = 0; i < 100; i++) {

    total += analogRead(CURRENT_PIN);

    delayMicroseconds(500);
  }

  float adc = total / 100.0;

  float adcVoltage =
    (adc / 4095.0) * 3.3;

  float sensorVoltage =
    adcVoltage * DIVIDER_FACTOR;

  float amps =
    (sensorVoltage - zeroVoltage)
    / ACS_SENSITIVITY;

  if (abs(amps) < 0.08) {
    amps = 0;
  }

  return abs(amps);
}


// ================= AI API =================
void sendToAI() {

  if (WiFi.status() != WL_CONNECTED) {

    Serial.println(
      "AI: WiFi not connected"
    );

    return;
  }

  HTTPClient http;

  http.begin(AI_URL);

  http.addHeader(
    "Content-Type",
    "application/json"
  );

  String json =
    "{\"temperature\":" +
    String(temperature, 1) +
    ",\"vibration\":" +
    String(vibration) +
    ",\"current\":" +
    String(current, 2) +
    "}";

  Serial.println(
    "Sending to AI:"
  );

  Serial.println(json);

  int code = http.POST(json);

  if (code > 0) {

    String response =
      http.getString();

    Serial.print(
      "AI Response: "
    );

    Serial.println(response);

    // Read prediction
    if (response.indexOf("FAULT") >= 0) {

      aiPrediction = "FAULT";

    }

    else if (response.indexOf("WARNING") >= 0) {

      aiPrediction = "WARNING";

    }

    else if (response.indexOf("NORMAL") >= 0) {

      aiPrediction = "NORMAL";

    }

    else {

      aiPrediction = "UNKNOWN";
    }

  }

  else {

    Serial.print(
      "AI connection error: "
    );

    Serial.println(code);

    aiPrediction = "OFFLINE";
  }

  http.end();
}


// ================= DASHBOARD =================
void handleRoot() {

  String page = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="2">
<title>PredictX • ESP32 AI Monitor</title>
<style>
  :root {
    --bg: #090d0b;
    --panel: rgba(18, 24, 20, 0.85);
    --border: rgba(196, 241, 105, 0.12);
    --lime: #c4f169;
    --cyan: #71e1d1;
    --green: #4ade80;
    --amber: #facc15;
    --red: #f87171;
    --text: #f1f5f0;
    --muted: #8b998a;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: radial-gradient(ellipse at 50% 0%, #152018 0%, var(--bg) 70%);
    color: var(--text);
    min-height: 100vh;
    padding: 24px 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .container {
    width: 100%;
    max-width: 640px;
  }
  header {
    text-align: center;
    margin-bottom: 24px;
  }
  .logo {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.5px;
    color: var(--lime);
    text-shadow: 0 0 20px rgba(196, 241, 105, 0.25);
  }
  .subtitle {
    color: var(--muted);
    font-size: 12px;
    letter-spacing: 1px;
    text-transform: uppercase;
    margin-top: 4px;
  }
  .live-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(196, 241, 105, 0.08);
    border: 1px solid rgba(196, 241, 105, 0.2);
    color: var(--lime);
    padding: 4px 12px;
    border-radius: 999px;
    font-size: 11px;
    font-family: monospace;
    margin-top: 10px;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--lime);
    box-shadow: 0 0 8px var(--lime);
    animation: pulse 1.8s infinite;
  }
  .status-hero {
    background: var(--panel);
    border: 1px solid var(--border);
    backdrop-filter: blur(12px);
    border-radius: 18px;
    padding: 24px;
    text-align: center;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4);
    margin-bottom: 16px;
  }
  .status-hero .label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: var(--muted);
    margin-bottom: 8px;
  }
  .badge {
    display: inline-block;
    font-size: 24px;
    font-weight: 800;
    letter-spacing: 1.5px;
    padding: 6px 20px;
    border-radius: 12px;
    border: 1px solid transparent;
  }
  .status-NORMAL {
    color: var(--green);
    background: rgba(74, 222, 128, 0.12);
    border-color: rgba(74, 222, 128, 0.3);
    text-shadow: 0 0 16px rgba(74, 222, 128, 0.3);
  }
  .status-WARNING {
    color: var(--amber);
    background: rgba(250, 204, 21, 0.12);
    border-color: rgba(250, 204, 21, 0.35);
    text-shadow: 0 0 16px rgba(250, 204, 21, 0.3);
  }
  .status-FAULT {
    color: var(--red);
    background: rgba(248, 113, 113, 0.15);
    border-color: rgba(248, 113, 113, 0.4);
    text-shadow: 0 0 20px rgba(248, 113, 113, 0.4);
    animation: pulse-red 1.5s infinite;
  }
  .status-WAITING, .status-OFFLINE, .status-UNKNOWN, .status-STARTING {
    color: var(--cyan);
    background: rgba(113, 225, 209, 0.1);
    border-color: rgba(113, 225, 209, 0.25);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 14px;
    margin-bottom: 16px;
  }
  .card {
    background: var(--panel);
    border: 1px solid var(--border);
    backdrop-filter: blur(12px);
    border-radius: 16px;
    padding: 18px 16px;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.3);
    position: relative;
    overflow: hidden;
    transition: transform 0.2s, border-color 0.2s;
  }
  .card:hover {
    transform: translateY(-2px);
    border-color: rgba(196, 241, 105, 0.3);
  }
  .card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .card-icon {
    font-size: 20px;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    background: rgba(196, 241, 105, 0.08);
    border: 1px solid rgba(196, 241, 105, 0.15);
  }
  .card-title {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--muted);
    font-weight: 600;
  }
  .card-value {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.5px;
    color: #fff;
    margin-bottom: 4px;
    font-family: monospace;
  }
  .card-meta {
    font-size: 10px;
    color: var(--muted);
    font-family: monospace;
  }
  .ai-card {
    grid-column: span 2;
    background: linear-gradient(135deg, rgba(25, 34, 28, 0.9), rgba(16, 22, 18, 0.9));
    border-color: rgba(196, 241, 105, 0.25);
  }
  .vib-NORMAL { color: var(--green); }
  .vib-DETECTED { color: var(--red); animation: pulse-red 1.5s infinite; }
  footer {
    text-align: center;
    color: var(--muted);
    font-size: 10px;
    font-family: monospace;
    letter-spacing: 0.5px;
    margin-top: 12px;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.9); }
  }
  @keyframes pulse-red {
    0%, 100% { box-shadow: 0 0 0 rgba(248, 113, 113, 0); }
    50% { box-shadow: 0 0 16px rgba(248, 113, 113, 0.4); }
  }
  @media (max-width: 440px) {
    .grid { grid-template-columns: 1fr; }
    .ai-card { grid-column: span 1; }
  }
</style>
</head>
<body>
<div class="container">
  <header>
    <div class="logo">⚙️ PredictX</div>
    <div class="subtitle">Edge AI Predictive Maintenance</div>
    <div class="live-pill"><span class="dot"></span> Live Telemetry (2s Refresh)</div>
  </header>

  <div class="status-hero">
    <div class="label">Machine Overall Status</div>
    <div class="badge status-%STATUS%">%STATUS%</div>
  </div>

  <div class="grid">
    <div class="card ai-card">
      <div class="card-top">
        <div class="card-title">Random Forest AI Prediction</div>
        <div class="card-icon">🤖</div>
      </div>
      <div class="card-value badge status-%AI%">%AI%</div>
      <div class="card-meta">Realtime Cloud Inference via Flask API</div>
    </div>

    <div class="card">
      <div class="card-top">
        <div class="card-title">Temperature</div>
        <div class="card-icon">🌡️</div>
      </div>
      <div class="card-value">%TEMP% °C</div>
      <div class="card-meta">DS18B20 1-Wire Digital</div>
    </div>

    <div class="card">
      <div class="card-top">
        <div class="card-title">Vibration</div>
        <div class="card-icon">📳</div>
      </div>
      <div class="card-value vib-%VIB%">%VIB%</div>
      <div class="card-meta">SW-420 High-Sensitivity</div>
    </div>

    <div class="card" style="grid-column: span 2;">
      <div class="card-top">
        <div class="card-title">Motor Load Current</div>
        <div class="card-icon">⚡</div>
      </div>
      <div class="card-value">%CURRENT% A</div>
      <div class="card-meta">ACS712 Hall-Effect Sensor (Auto-Calibrated)</div>
    </div>
  </div>

  <footer>
    PredictX Edge v2.0 • ESP32 + AI Cloud Synchronization
  </footer>
</div>
</body>
</html>
)rawliteral";


  page.replace(
    "%STATUS%",
    status
  );


  page.replace(
    "%AI%",
    aiPrediction
  );


  page.replace(
    "%TEMP%",
    String(temperature, 1)
  );


  page.replace(
    "%CURRENT%",
    String(current, 2)
  );


  if (vibration == HIGH) {

    page.replace(
      "%VIB%",
      "DETECTED"
    );

  }

  else {

    page.replace(
      "%VIB%",
      "NORMAL"
    );
  }


  server.send(
    200,
    "text/html",
    page
  );
}


// ================= SETUP =================
void setup() {

  Serial.begin(115200);


  // Vibration
  pinMode(
    VIBRATION_PIN,
    INPUT
  );


  // ADC
  analogReadResolution(12);


  // LEDs
  pinMode(
    BLUE_LED,
    OUTPUT
  );

  pinMode(
    YELLOW_LED,
    OUTPUT
  );

  pinMode(
    RED_LED,
    OUTPUT
  );


  // Buzzer
  pinMode(
    BUZZER,
    OUTPUT
  );


  // All LEDs OFF
  digitalWrite(
    BLUE_LED,
    LOW
  );

  digitalWrite(
    YELLOW_LED,
    LOW
  );

  digitalWrite(
    RED_LED,
    LOW
  );


  // Active-low buzzer OFF
  digitalWrite(
    BUZZER,
    HIGH
  );


  // ================= OLED =================

  Wire.begin(21, 22);


  if (!display.begin(
        SSD1306_SWITCHCAPVCC,
        0x3C)) {

    Serial.println(
      "OLED NOT FOUND"
    );

    while (1);
  }


  // ================= TEMPERATURE =================

  tempSensor.begin();


  // ================= ACS712 CALIBRATION =================

  Serial.println();

  Serial.println(
    "PREDICTX STARTING"
  );

  Serial.println(
    "Keep motor OFF..."
  );

  Serial.println(
    "Calibrating ACS712..."
  );


  delay(2000);


  long total = 0;


  for (int i = 0; i < 1000; i++) {

    total += analogRead(
      CURRENT_PIN
    );

    delay(2);
  }


  float averageADC =
    total / 1000.0;


  float adcVoltage =
    (averageADC / 4095.0) * 3.3;


  zeroVoltage =
    adcVoltage * DIVIDER_FACTOR;


  Serial.print(
    "ACS712 Zero Voltage: "
  );

  Serial.println(
    zeroVoltage,
    3
  );


  // ================= WIFI =================

  Serial.println();

  Serial.println(
    "Connecting to WiFi..."
  );


  WiFi.begin(
    ssid,
    password
  );


  while (
    WiFi.status() != WL_CONNECTED
  ) {

    delay(500);

    Serial.print(".");
  }


  Serial.println();

  Serial.println(
    "WiFi Connected!"
  );


  Serial.print(
    "ESP32 IP: "
  );

  Serial.println(
    WiFi.localIP()
  );


  // ================= WEB SERVER =================

  server.on(
    "/",
    handleRoot
  );


  server.begin();


  Serial.println(
    "Dashboard started!"
  );


  Serial.print(
    "AI Server: "
  );

  Serial.println(
    AI_URL
  );
}


// ================= LOOP =================
void loop() {


  // ================= READ TEMPERATURE =================

  tempSensor.requestTemperatures();

  temperature =
    tempSensor.getTempCByIndex(0);


  // ================= READ VIBRATION =================

  vibration =
    digitalRead(
      VIBRATION_PIN
    );


  // ================= READ CURRENT =================

  current =
    readCurrent();


  // ================= TURN EVERYTHING OFF =================

  digitalWrite(
    BLUE_LED,
    LOW
  );

  digitalWrite(
    YELLOW_LED,
    LOW
  );

  digitalWrite(
    RED_LED,
    LOW
  );


  // Buzzer OFF
  digitalWrite(
    BUZZER,
    HIGH
  );


  // =====================================================
  //                    FAULT CONDITION
  // =====================================================
  //
  // ANY ONE of these causes:
  //
  // Vibration detected
  // Temperature >= 60°C
  // Current >= 2.00A
  //
  // Result:
  // RED LED + BUZZER
  //
  // =====================================================

  if (
    vibration == HIGH ||
    temperature >= TEMP_FAULT ||
    current >= CURRENT_FAULT
  ) {

    status = "FAULT";


    // RED LED ON
    digitalWrite(
      RED_LED,
      HIGH
    );


    // BUZZER ON
    digitalWrite(
      BUZZER,
      LOW
    );
  }


  // =====================================================
  //                    WARNING CONDITION
  // =====================================================
  //
  // Temperature >= 45°C
  // OR
  // Current >= 1.20A
  //
  // Result:
  // YELLOW LED
  //
  // =====================================================

  else if (
    temperature >= TEMP_WARNING ||
    current >= CURRENT_WARNING
  ) {

    status = "WARNING";


    // YELLOW LED ON
    digitalWrite(
      YELLOW_LED,
      HIGH
    );


    // Buzzer remains OFF
  }


  // =====================================================
  //                    NORMAL CONDITION
  // =====================================================

  else {

    status = "NORMAL";


    // BLUE LED ON
    digitalWrite(
      BLUE_LED,
      HIGH
    );


    // Buzzer remains OFF
  }


  // ================= SERIAL MONITOR =================

  Serial.println(
    "-------------------------"
  );


  Serial.print(
    "Temperature: "
  );

  Serial.print(
    temperature,
    1
  );

  Serial.println(
    " C"
  );


  Serial.print(
    "Vibration: "
  );


  if (vibration) {

    Serial.println(
      "DETECTED"
    );

  }

  else {

    Serial.println(
      "NORMAL"
    );
  }


  Serial.print(
    "Current: "
  );

  Serial.print(
    current,
    2
  );

  Serial.println(
    " A"
  );


  Serial.print(
    "Status: "
  );

  Serial.println(
    status
  );


  Serial.print(
    "Thresholds -> Temp: "
  );

  Serial.print(
    TEMP_WARNING
  );

  Serial.print(
    "/"
  );

  Serial.print(
    TEMP_FAULT
  );

  Serial.print(
    " C | Current: "
  );

  Serial.print(
    CURRENT_WARNING
  );

  Serial.print(
    "/"
  );

  Serial.print(
    CURRENT_FAULT
  );

  Serial.println(
    " A"
  );


  // ================= AI =================

  sendToAI();


  Serial.print(
    "AI Prediction: "
  );

  Serial.println(
    aiPrediction
  );


  // ================= OLED =================

  display.clearDisplay();


  display.setTextColor(
    SSD1306_WHITE
  );


  display.setTextSize(1);


  display.setCursor(
    0,
    0
  );


  display.println(
    "PREDICTX MACHINE"
  );


  display.setCursor(
    0,
    13
  );


  display.print(
    "Temp: "
  );


  display.print(
    temperature,
    1
  );


  display.println(
    " C"
  );


  display.setCursor(
    0,
    26
  );


  display.print(
    "Vib: "
  );


  if (vibration) {

    display.println(
      "DETECTED"
    );

  }

  else {

    display.println(
      "NORMAL"
    );
  }


  display.setCursor(
    0,
    39
  );


  display.print(
    "Current: "
  );


  display.print(
    current,
    2
  );


  display.println(
    " A"
  );


  display.setCursor(
    0,
    52
  );


  display.print(
    "AI: "
  );


  display.println(
    aiPrediction
  );


  display.display();


  // ================= WEB SERVER =================

  server.handleClient();


  // Read sensors every 3 seconds
  delay(3000);
}