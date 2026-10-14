# PredictX AI Module

## Purpose
Train a Random Forest classifier using temperature, vibration and current readings.

## Files
- `predictx_dataset.csv` - 500-row synthetic starter dataset.
- `train_model.py` - trains and saves `model.pkl`.
- `predict.py` - tests a single sensor reading against the trained model.
- `requirements.txt` - Python packages.

## Setup
Open a terminal in this `ai` folder:

```bash
pip install -r requirements.txt
python train_model.py
```

Then test:

```bash
python predict.py 30.6 0 0.86
```

## Important
The supplied dataset is synthetic starter data. Do not present its test accuracy as real-world model accuracy. For a real hackathon validation, collect real ESP32 readings under safe, controlled normal/warning/fault scenarios and retrain/validate the model.
