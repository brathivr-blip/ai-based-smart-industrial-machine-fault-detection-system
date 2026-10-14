from flask import Flask, request, jsonify
from flask_cors import CORS
import joblib
import pandas as pd
from datetime import datetime, timezone
import pymongo

app = Flask(__name__)
CORS(app)

MONGO_URI = "mongodb+srv://brathivr_db_user:brathiv%40123@cluster0.meqfxed.mongodb.net/predictx?retryWrites=true&w=majority"
try:
    mongo_client = pymongo.MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    db = mongo_client["predictx"]
    telemetry_collection = db["telemetry"]
    print("MongoDB Atlas connected in API service.")
except Exception as e:
    telemetry_collection = None
    print("MongoDB connection warning:", e)

import os
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
model_path = os.path.join(BASE_DIR, "model.pkl")
model = joblib.load(model_path)

latest = {
    "temperature": 0,
    "vibration": 0,
    "current": 0,
    "status": "WAITING",
    "ai_prediction": "WAITING",
    "confidence": 98.0
}


@app.route("/predict", methods=["POST"])
def predict():
    global latest

    data = request.json

    temperature = float(data["temperature"])
    vibration = int(data["vibration"])
    current = float(data["current"])

    sample = pd.DataFrame([{
        "Temperature_C": temperature,
        "Vibration": vibration,
        "Current_A": current
    }])

    prediction = model.predict(sample)[0]
    confidence = 98.0
    if hasattr(model, "predict_proba"):
        try:
            probs = model.predict_proba(sample)[0]
            confidence = round(float(max(probs)) * 100, 1)
        except Exception:
            confidence = 98.0

    # Safety thresholds
    if vibration == 1 or temperature >= 60 or current >= 2.0:
        status = "FAULT"
    elif temperature >= 45 or current >= 1.2:
        status = "WARNING"
    else:
        status = "NORMAL"

    print(f"[PredictX AI] ESP32 Data -> Temp: {temperature} C, Vib: {vibration}, Current: {current} A | Prediction: {prediction} ({confidence}%), Status: {status}")

    latest = {
        "temperature": temperature,
        "vibration": vibration,
        "current": current,
        "status": status,
        "ai_prediction": prediction,
        "confidence": confidence,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

    # Store in MongoDB
    if telemetry_collection is not None:
        try:
            telemetry_collection.insert_one({
                "temperature": temperature,
                "vibration": vibration,
                "current": current,
                "status": status,
                "ai_prediction": prediction,
                "confidence": confidence,
                "timestamp": datetime.now(timezone.utc)
            })
        except Exception as e:
            print("Failed to save telemetry to MongoDB:", e)

    return jsonify({
        "prediction": prediction,
        "status": status,
        "confidence": confidence
    })


@app.route("/latest")
def get_latest():
    return jsonify(latest)


@app.route("/history")
def get_history():
    if telemetry_collection is not None:
        try:
            docs = list(telemetry_collection.find({}, {"_id": 0}).sort("timestamp", -1).limit(30))
            return jsonify({"success": True, "history": docs})
        except Exception as e:
            return jsonify({"success": False, "error": str(e)})
    return jsonify({"success": True, "history": []})


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5000,
        debug=False
    )