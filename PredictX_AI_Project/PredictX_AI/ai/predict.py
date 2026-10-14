import sys
import joblib
import pandas as pd

model = joblib.load("model.pkl")

# Usage:
# python predict.py 30.6 0 0.86
if len(sys.argv) != 4:
    print("Usage: python predict.py <temperature_C> <vibration_0_or_1> <current_A>")
    raise SystemExit(1)

temperature = float(sys.argv[1])
vibration = int(sys.argv[2])
current = float(sys.argv[3])

sample = pd.DataFrame([{
    "Temperature_C": temperature,
    "Vibration": vibration,
    "Current_A": current
}])

prediction = model.predict(sample)[0]
probabilities = model.predict_proba(sample)[0]

print("PredictX Prediction")
print("-------------------")
print("Temperature:", temperature, "C")
print("Vibration:", "DETECTED" if vibration else "NORMAL")
print("Current:", current, "A")
print("AI Status:", prediction)

for label, probability in zip(model.classes_, probabilities):
    print(f"{label}: {probability*100:.1f}%")
