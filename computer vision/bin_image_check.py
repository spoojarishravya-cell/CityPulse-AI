from pathlib import Path
from ultralytics import YOLO

MODEL_PATH = Path("yolo26n.pt")
IMAGE_PATH = input("Enter image filename: ").strip()

if not Path(IMAGE_PATH).is_file():
    print(f"Image not found: {IMAGE_PATH}")
    raise SystemExit(1)

model = YOLO(str(MODEL_PATH))
results = model.predict(
    source=IMAGE_PATH,
    conf=0.25,
    device="cpu",
    save=True,
    verbose=False,
)

names = model.names
detections = []

for result in results:
    for box in result.boxes:
        class_id = int(box.cls[0].item())
        detections.append({
            "label": names[class_id],
            "confidence": round(float(box.conf[0].item()), 3),
        })

print("\n--- IMAGE CHECK ---")
if detections:
    for detection in detections:
        print(
            f"{detection['label']}: "
            f"{detection['confidence']:.1%} model confidence"
        )
else:
    print("No objects detected above the confidence threshold.")

print("\nNote: This model has no dedicated waste-bin class.")
print("These results do not estimate bin fullness or confirm overflow.")
print("Annotated images are saved under runs/detect/.")