import pandas as pd
import joblib
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report

DATA_FILE = "predictx_dataset.csv"
MODEL_FILE = "model.pkl"

data = pd.read_csv(DATA_FILE)

features = ["Temperature_C", "Vibration", "Current_A"]
X = data[features]
y = data["Status"]

X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.20, random_state=42, stratify=y
)

model = RandomForestClassifier(
    n_estimators=100,
    random_state=42
)
model.fit(X_train, y_train)

pred = model.predict(X_test)
accuracy = accuracy_score(y_test, pred)

print("=== PredictX AI Training ===")
print(f"Rows: {len(data)}")
print(f"Accuracy on synthetic test split: {accuracy*100:.2f}%")
print("\nClassification report:")
print(classification_report(y_test, pred))

joblib.dump(model, MODEL_FILE)
print(f"\nSaved: {MODEL_FILE}")
print("NOTE: This dataset is synthetic. Replace/validate with real ESP32 data before claiming field accuracy.")
